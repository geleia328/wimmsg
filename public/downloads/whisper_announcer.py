#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bakers Whisper Announcer — TTS para whispers do WoW
====================================================

Programa leve que:
  1. Monitora WoWChatLog.txt em tempo real
  2. Detecta whispers recebidos (via addon WIMBridge)
  3. Anuncia em voz alta quem mandou e o que disse
  4. Mostra histórico de whispers em uma janela
  5. Pode integrar com o site Bakers Whisper

NÃO envia mensagens. NÃO pressiona teclas. NÃO automatisa nada.
É apenas um leitor de chat com voz.

Requisitos:
  pip install pyttsx3 psutil
  
Ou compile com PyInstaller:
  pyinstaller --onefile --windowed whisper_announcer.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
import tkinter as tk
from dataclasses import dataclass, field
from pathlib import Path
from tkinter import messagebox, scrolledtext, ttk
from typing import Optional

# TTS
try:
    import pyttsx3
    HAS_TTS = True
except ImportError:
    HAS_TTS = False

# Process detection (optional — for future WoW detection)
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# ─── Constants ──────────────────────────────────────────────────────────────
APP_NAME = "Bakers Whisper Announcer"
APP_VERSION = "1.0.0"

# WoW chat log locations (common paths)
WOW_LOG_PATHS = [
    Path(os.environ.get("PROGRAMFILES(X86)", "")) / "World of Warcraft" / "_retail_" / "Logs" / "WoWChatLog.txt",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "World of Warcraft" / "_retail_" / "Logs" / "WoWChatLog.txt",
    Path(os.path.expanduser("~")) / "Games" / "World of Warcraft" / "_retail_" / "Logs" / "WoWChatLog.txt",
]

# Theme colors
BG = "#0f172a"
BG2 = "#1e293b"
CARD = "#1e293b"
BORDER = "#334155"
FG = "#e2e8f0"
MUTED = "#94a3b8"
ACCENT = "#f59e0b"
ACCENT2 = "#fbbf24"
OK = "#10b981"
BAD = "#ef4444"
LINK = "#38bdf8"

# Regex to parse [WIMBRIDGE] lines from the WoWChatLog.txt
# Format: [WIMBRIDGE]<OWN:CharName-Realm><FROM:OtherName-Realm>message text here
WIMBRIDGE_RE = re.compile(
    r"\[WIMBRIDGE\]<OWN:([^>]+)><FROM:([^>]+)>(.+)",
    re.IGNORECASE,
)

# ─── Data Classes ───────────────────────────────────────────────────────────
@dataclass
class WhisperMessage:
    own_char: str          # Your character (who received the whisper)
    from_char: str         # Who sent the whisper
    message: str           # The message content
    timestamp: float       # Time.time() when detected
    line_number: int       # Line number in the log file
    hash: str = ""         # Unique ID for deduplication

    def __post_init__(self):
        if not self.hash:
            raw = f"{self.own_char}|{self.from_char}|{self.message}|{self.line_number}"
            self.hash = hashlib.md5(raw.encode()).hexdigest()[:12]


@dataclass
class VoiceSettings:
    rate: int = 175        # Words per minute
    volume: float = 0.9    # 0.0 to 1.0
    voice_index: int = 0   # Index into available voices
    enabled: bool = True
    announce_char_name: bool = True   # Say "Jaina, you have a whisper from..."
    announce_message: bool = True     # Say the message content
    prefix: str = "Whisper from"      # "Whisper from Malaquias: hello"


# ─── TTS Engine ─────────────────────────────────────────────────────────────
class TTSEngine:
    def __init__(self):
        self.engine = None
        self.lock = threading.Lock()
        self._queue: list[str] = []
        self._speaking = False
        if HAS_TTS:
            try:
                self.engine = pyttsx3.init()
                self._configure()
            except Exception:
                self.engine = None

    def _configure(self):
        if not self.engine:
            return
        try:
            self.engine.setProperty("rate", 175)
            self.engine.setProperty("volume", 0.9)
        except Exception:
            pass

    def get_voices(self) -> list[str]:
        if not self.engine:
            return []
        try:
            voices = self.engine.getProperty("voices")
            return [v.name for v in voices]
        except Exception:
            return []

    def apply_settings(self, settings: VoiceSettings):
        if not self.engine:
            return
        try:
            self.engine.setProperty("rate", settings.rate)
            self.engine.setProperty("volume", settings.volume)
            voices = self.engine.getProperty("voices")
            if 0 <= settings.voice_index < len(voices):
                self.engine.setProperty("voice", voices[settings.voice_index].id)
        except Exception:
            pass

    def speak(self, text: str):
        if not self.engine or not text.strip():
            return
        self._queue.append(text)
        if not self._speaking:
            threading.Thread(target=self._process_queue, daemon=True).start()

    def _process_queue(self):
        self._speaking = True
        while self._queue:
            text = self._queue.pop(0)
            try:
                with self.lock:
                    if self.engine:
                        self.engine.say(text)
                        self.engine.runAndWait()
            except Exception:
                pass
            time.sleep(0.1)  # Small gap between messages
        self._speaking = False

    def stop(self):
        self._queue.clear()
        try:
            if self.engine:
                self.engine.stop()
        except Exception:
            pass


# ─── Log Monitor ────────────────────────────────────────────────────────────
class LogMonitor:
    def __init__(
        self,
        log_path: Path,
        callback,
        stop_event: threading.Event,
    ):
        self.log_path = log_path
        self.callback = callback  # Called with WhisperMessage
        self.stop_event = stop_event
        self.last_line = 0
        self.file = None

    def start(self):
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        # Wait for file to exist
        while not self.stop_event.is_set():
            if self.log_path.exists():
                break
            time.sleep(1)

        if self.stop_event.is_set():
            return

        # Open file and seek to end (only process new lines)
        try:
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                # Count existing lines to skip them
                self.last_line = 0
                for _ in f:
                    self.last_line += 1
                # Now tail from the end
            self._tail()
        except Exception as e:
            print(f"Log monitor error: {e}")

    def _tail(self):
        """Tail the file like 'tail -f', processing new lines."""
        while not self.stop_event.is_set():
            try:
                with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                    # Skip to where we left off
                    current_line = 0
                    for line in f:
                        current_line += 1
                        if current_line <= self.last_line:
                            continue
                        self._process_line(line.rstrip("\n\r"), current_line)
                    self.last_line = current_line
            except Exception:
                pass
            time.sleep(0.5)  # Check every 500ms

    def _process_line(self, line: str, line_number: int):
        match = WIMBRIDGE_RE.search(line)
        if not match:
            return

        own_char = match.group(1).strip()
        from_char = match.group(2).strip()
        message = match.group(3).strip()

        if not from_char or not message:
            return

        whisper = WhisperMessage(
            own_char=own_char,
            from_char=from_char,
            message=message,
            timestamp=time.time(),
            line_number=line_number,
        )

        self.callback(whisper)


# ─── UI ─────────────────────────────────────────────────────────────────────
class AnnouncerUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(APP_NAME)
        self.root.geometry("680x520")
        self.root.minsize(500, 400)
        self.root.configure(bg=BG)

        self.tts = TTSEngine()
        self.settings = VoiceSettings()
        self.whispers: list[WhisperMessage] = []
        self.monitor: Optional[LogMonitor] = None
        self.stop_event = threading.Event()
        self.log_path = self._find_log()
        self.played_hashes: set[str] = set()  # Deduplication

        self._build_ui()
        self._start_monitor()

    def _find_log(self) -> Optional[Path]:
        for p in WOW_LOG_PATHS:
            if p.exists():
                return p
        return None

    def _build_ui(self):
        # Header
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=16, pady=(12, 4))

        tk.Label(
            header,
            text=f"🔊 {APP_NAME}",
            bg=BG,
            fg=ACCENT2,
            font=("Segoe UI", 14, "bold"),
        ).pack(side="left")

        tk.Label(
            header,
            text=f"v{APP_VERSION}",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 9),
        ).pack(side="left", padx=(8, 0))

        self.status_lbl = tk.Label(
            header,
            text="⏳ monitorando...",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 9),
        )
        self.status_lbl.pack(side="right")

        # Info card
        info = tk.Frame(self.root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        info.pack(fill="x", padx=16, pady=(0, 8))
        tk.Label(
            info,
            text=(
                "1) Instale o addon WIMBridge no WoW\n"
                "2) Digite /chatlog em cada janela do WoW\n"
                "3) Abra este programa\n"
                "4) Whispers recebidos serão anunciados em voz alta"
            ),
            bg=CARD,
            fg=FG,
            justify="left",
            font=("Segoe UI", 9),
            padx=12,
            pady=8,
        ).pack(anchor="w")

        # Voice settings card
        voice_card = tk.Frame(self.root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        voice_card.pack(fill="x", padx=16, pady=(0, 8))

        tk.Label(
            voice_card,
            text="🎙 Configurações de voz",
            bg=CARD,
            fg=ACCENT,
            font=("Segoe UI", 10, "bold"),
            padx=12,
            pady=(8, 4),
        ).pack(anchor="w")

        settings_row = tk.Frame(voice_card, bg=CARD)
        settings_row.pack(fill="x", padx=12, pady=(0, 8))

        # TTS toggle
        self.tts_var = tk.BooleanVar(value=self.settings.enabled)
        tk.Checkbutton(
            settings_row,
            text="TTS ligado",
            variable=self.tts_var,
            bg=CARD,
            fg=FG,
            selectcolor=BG,
            activebackground=CARD,
            activeforeground=FG,
            command=self._apply_settings,
        ).pack(side="left")

        # Rate slider
        tk.Label(settings_row, text="Velocidade:", bg=CARD, fg=MUTED, font=("Segoe UI", 9)).pack(side="left", padx=(16, 4))
        self.rate_var = tk.IntVar(value=self.settings.rate)
        self.rate_lbl = tk.Label(settings_row, text=str(self.settings.rate), bg=CARD, fg=FG, font=("Segoe UI", 9), width=4)
        self.rate_lbl.pack(side="left")
        tk.Scale(
            settings_row,
            from_=80,
            to=300,
            orient="horizontal",
            variable=self.rate_var,
            bg=CARD,
            fg=FG,
            troughcolor=BG,
            highlightthickness=0,
            length=120,
            command=lambda v: self._apply_settings(),
        ).pack(side="left")

        # Volume slider
        tk.Label(settings_row, text="Vol:", bg=CARD, fg=MUTED, font=("Segoe UI", 9)).pack(side="left", padx=(12, 4))
        self.vol_var = tk.IntVar(value=int(self.settings.volume * 100))
        self.vol_lbl = tk.Label(settings_row, text=f"{int(self.settings.volume * 100)}%", bg=CARD, fg=FG, font=("Segoe UI", 9), width=4)
        self.vol_lbl.pack(side="left")
        tk.Scale(
            settings_row,
            from_=0,
            to=100,
            orient="horizontal",
            variable=self.vol_var,
            bg=CARD,
            fg=FG,
            troughcolor=BG,
            highlightthickness=0,
            length=100,
            command=lambda v: self._apply_settings(),
        ).pack(side="left")

        # Voice selector
        voices = self.tts.get_voices()
        if voices:
            tk.Label(settings_row, text="Voz:", bg=CARD, fg=MUTED, font=("Segoe UI", 9)).pack(side="left", padx=(12, 4))
            self.voice_var = tk.StringVar(value=voices[0] if voices else "")
            ttk.Combobox(
                settings_row,
                textvariable=self.voice_var,
                values=voices,
                state="readonly",
                width=20,
            ).pack(side="left")
            self.voice_var.trace_add("write", lambda *_: self._apply_settings())

        # Log path selector
        path_row = tk.Frame(voice_card, bg=CARD)
        path_row.pack(fill="x", padx=12, pady=(0, 8))
        tk.Label(path_row, text="Log path:", bg=CARD, fg=MUTED, font=("Segoe UI", 9)).pack(side="left")
        self.log_var = tk.StringVar(value=str(self.log_path) if self.log_path else "")
        tk.Entry(
            path_row,
            textvariable=self.log_var,
            bg=BG,
            fg=FG,
            insertbackground=FG,
            font=("Consolas", 9),
            width=50,
        ).pack(side="left", padx=(8, 4), fill="x", expand=True)
        tk.Button(
            path_row,
            text="📂",
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 9),
            command=self._browse_log,
        ).pack(side="left")

        # Test TTS button
        tk.Button(
            settings_row,
            text="🔊 Testar voz",
            bg=BG,
            fg=ACCENT2,
            font=("Segoe UI", 9),
            relief="flat",
            padx=8,
            pady=2,
            command=self._test_tts,
        ).pack(side="right")

        # Whisper history
        hist_label = tk.Frame(self.root, bg=BG)
        hist_label.pack(fill="x", padx=16)
        tk.Label(
            hist_label,
            text="📜 Histórico de whispers",
            bg=BG,
            fg=FG,
            font=("Segoe UI", 10, "bold"),
        ).pack(side="left")

        self.count_lbl = tk.Label(
            hist_label,
            text="0 whispers",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 9),
        )
        self.count_lbl.pack(side="right")

        self.history = scrolledtext.ScrolledText(
            self.root,
            bg="#0a0f1a",
            fg=FG,
            insertbackground=FG,
            font=("Consolas", 9),
            state="disabled",
            wrap="word",
            relief="flat",
            highlightthickness=1,
            highlightbackground=BORDER,
        )
        self.history.pack(fill="both", expand=True, padx=16, pady=(4, 12))

        # Configure text tags for coloring
        self.history.tag_configure("timestamp", foreground=MUTED)
        self.history.tag_configure("own_char", foreground=OK)
        self.history.tag_configure("from_char", foreground=ACCENT2)
        self.history.tag_configure("message", foreground=FG)
        self.history.tag_configure("system", foreground=LINK)

        # Bottom buttons
        bottom = tk.Frame(self.root, bg=BG)
        bottom.pack(fill="x", padx=16, pady=(0, 12))
        tk.Button(
            bottom,
            text="🗑 Limpar histórico",
            bg=CARD,
            fg=MUTED,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=4,
            command=self._clear_history,
        ).pack(side="left")
        tk.Button(
            bottom,
            text="🔊 Anunciar tudo novamente",
            bg=CARD,
            fg=ACCENT2,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=4,
            command=self._replay_all,
        ).pack(side="left", padx=(8, 0))

    def _apply_settings(self):
        self.settings.enabled = self.tts_var.get()
        self.settings.rate = self.rate_var.get()
        self.settings.volume = self.vol_var.get() / 100.0
        self.rate_lbl.configure(text=str(self.settings.rate))
        self.vol_lbl.configure(text=f"{self.vol_var.get()}%")
        # Voice selection
        voices = self.tts.get_voices()
        selected = self.voice_var.get() if hasattr(self, "voice_var") else ""
        if selected:
            for i, v in enumerate(voices):
                if v == selected:
                    self.settings.voice_index = i
                    break
        self.tts.apply_settings(self.settings)

    def _test_tts(self):
        self._apply_settings()
        self.tts.speak("Whisper from Malaquias. Hey, are you available for a dungeon run?")

    def _browse_log(self):
        from tkinter import filedialog
        path = filedialog.askopenfilename(
            title="Select WoWChatLog.txt",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
        )
        if path:
            self.log_var.set(path)
            self.log_path = Path(path)
            self._restart_monitor()

    def _start_monitor(self):
        if not self.log_path:
            self._append_system("⚠ Nenhum log do WoW encontrado. Configure o caminho manualmente.")
            self.status_lbl.configure(text="⚠ sem log", fg=BAD)
            return
        self.stop_event.clear()
        self.monitor = LogMonitor(self.log_path, self._on_whisper, self.stop_event)
        self.monitor.start()
        self.status_lbl.configure(text=f"🟢 monitorando: {self.log_path.name}", fg=OK)
        self._append_system(f"Monitorando: {self.log_path}")

    def _restart_monitor(self):
        self.stop_event.set()
        time.sleep(0.2)
        self.stop_event.clear()
        self._start_monitor()

    def _on_whisper(self, whisper: WhisperMessage):
        # Deduplication
        if whisper.hash in self.played_hashes:
            return
        self.played_hashes.add(whisper.hash)
        self.whispers.append(whisper)

        # Update UI in main thread
        self.root.after(0, lambda: self._display_whisper(whisper))

        # Speak
        if self.settings.enabled:
            text = self._build_speech(whisper)
            self.tts.speak(text)

    def _build_speech(self, w: WhisperMessage) -> str:
        parts = []
        if self.settings.announce_char_name:
            parts.append(f"Whisper from {w.from_char}.")
        if self.settings.announce_message:
            parts.append(w.message)
        return " ".join(parts) if parts else f"New whisper from {w.from_char}"

    def _display_whisper(self, w: WhisperMessage):
        ts = time.strftime("%H:%M:%S", time.localtime(w.timestamp))
        self.count_lbl.configure(text=f"{len(self.whispers)} whispers")

        self.history.configure(state="normal")
        # Timestamp
        self.history.insert("end", f"[{ts}] ", "timestamp")
        # Own char
        self.history.insert("end", f"{w.own_char} ", "own_char")
        # Arrow
        self.history.insert("end", "← ", "timestamp")
        # From char
        self.history.insert("end", f"{w.from_char}: ", "from_char")
        # Message
        self.history.insert("end", f"{w.message}\n\n", "message")
        self.history.configure(state="disabled")
        self.history.see("end")

    def _append_system(self, text: str):
        self.history.configure(state="normal")
        self.history.insert("end", f"ℹ {text}\n\n", "system")
        self.history.configure(state="disabled")
        self.history.see("end")

    def _clear_history(self):
        self.whispers.clear()
        self.played_hashes.clear()
        self.history.configure(state="normal")
        self.history.delete("1.0", "end")
        self.history.configure(state="disabled")
        self.count_lbl.configure(text="0 whispers")

    def _replay_all(self):
        if not self.settings.enabled:
            self._apply_settings()
        for w in self.whispers[-5:]:  # Last 5 only
            text = self._build_speech(w)
            self.tts.speak(text)

    def cleanup(self):
        self.stop_event.set()
        self.tts.stop()


# ─── Main ───────────────────────────────────────────────────────────────────
def main():
    root = tk.Tk()
    app = AnnouncerUI(root)

    def on_close():
        app.cleanup()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()


if __name__ == "__main__":
    main()
