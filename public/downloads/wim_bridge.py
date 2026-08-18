#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wim_bridge.py — versão CLI headless do bridge Bakers Whisper.

Responsabilidades:
- Ler WoWChatLog.txt em tempo real (tail).
- Parsear whispers do WIM/WoW e do addon WIMBridge (WIMRELAY/WIMBRIDGE).
- Postar mensagens em /api/ingest.
- Consultar /api/queue e enviar respostas nas janelas WoW corretas.
- Reportar janelas em /api/status/scan.
- Consultar /api/control e /api/gse para GSE spammers.

Requer Windows para envio no jogo (pywin32). Em outros SOs, apenas leitura
funciona.
"""
from __future__ import annotations

import argparse
import configparser
import json
import os
import re
import sys
import time
import threading
from dataclasses import dataclass, field
from typing import Optional

try:
    import requests
except Exception as e:  # pragma: no cover
    print("Instale requests: pip install requests", file=sys.stderr)
    raise

IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    try:
        import win32gui  # type: ignore
        import win32con  # type: ignore
        import win32api  # type: ignore
        import win32process  # type: ignore
        import psutil  # type: ignore
        import pyperclip  # type: ignore
    except Exception:
        win32gui = None  # type: ignore
        win32con = None  # type: ignore
        win32api = None  # type: ignore
        win32process = None  # type: ignore
        psutil = None  # type: ignore
        pyperclip = None  # type: ignore
else:
    win32gui = None
    win32con = None
    win32api = None
    win32process = None
    psutil = None
    pyperclip = None


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
@dataclass
class Config:
    base_url: str = "http://127.0.0.1:3000"
    bridge_token: str = ""
    chatlog_path: str = ""
    queue_poll_ms: int = 1500
    scan_ms: int = 3000
    focus_delay_ms: int = 2000
    chat_open_delay_ms: int = 1000
    keystroke_delay_ms: int = 100
    chat_send_delay_ms: int = 1000
    after_send_delay_ms: int = 1000
    close_chat_enabled: bool = True
    chat_close_delay_ms: int = 500
    # STT (leitura via text-to-speech do addon + speech-to-text local)
    stt_enabled: bool = False
    stt_model: str = "small"
    stt_device: str = "cpu"
    stt_compute: str = "int8"
    stt_language: str = "en"
    stt_device_name: str = ""
    stt_own_character: str = ""  # fallback quando não sabemos qual janela falou
    stt_rms_threshold: float = 0.008
    stt_silence_ms: int = 700
    stt_max_utter_ms: int = 12000


def load_config(path: str) -> Config:
    cp = configparser.ConfigParser()
    if os.path.exists(path):
        cp.read(path, encoding="utf-8")
    c = Config()
    if cp.has_section("server"):
        c.base_url = cp.get("server", "base_url", fallback=c.base_url)
        c.bridge_token = cp.get("server", "bridge_token", fallback=c.bridge_token)
    if cp.has_section("bridge"):
        c.chatlog_path = cp.get("bridge", "chatlog_path", fallback=c.chatlog_path)
        c.queue_poll_ms = cp.getint("bridge", "queue_poll_ms", fallback=c.queue_poll_ms)
        c.scan_ms = cp.getint("bridge", "scan_ms", fallback=c.scan_ms)
    if cp.has_section("send"):
        c.focus_delay_ms = cp.getint("send", "focus_delay_ms", fallback=c.focus_delay_ms)
        c.chat_open_delay_ms = cp.getint("send", "chat_open_delay_ms", fallback=c.chat_open_delay_ms)
        c.keystroke_delay_ms = cp.getint("send", "keystroke_delay_ms", fallback=c.keystroke_delay_ms)
        c.chat_send_delay_ms = cp.getint("send", "chat_send_delay_ms", fallback=c.chat_send_delay_ms)
        c.after_send_delay_ms = cp.getint("send", "after_send_delay_ms", fallback=c.after_send_delay_ms)
        c.close_chat_enabled = cp.getboolean("send", "close_chat_enabled", fallback=c.close_chat_enabled)
        c.chat_close_delay_ms = cp.getint("send", "chat_close_delay_ms", fallback=c.chat_close_delay_ms)
    if cp.has_section("stt"):
        c.stt_enabled = cp.getboolean("stt", "enabled", fallback=c.stt_enabled)
        c.stt_model = cp.get("stt", "model", fallback=c.stt_model)
        c.stt_device = cp.get("stt", "device", fallback=c.stt_device)
        c.stt_compute = cp.get("stt", "compute_type", fallback=c.stt_compute)
        c.stt_language = cp.get("stt", "language", fallback=c.stt_language)
        c.stt_device_name = cp.get("stt", "device_name", fallback=c.stt_device_name)
        c.stt_own_character = cp.get("stt", "own_character", fallback=c.stt_own_character)
        c.stt_rms_threshold = cp.getfloat("stt", "rms_threshold", fallback=c.stt_rms_threshold)
        c.stt_silence_ms = cp.getint("stt", "silence_ms", fallback=c.stt_silence_ms)
        c.stt_max_utter_ms = cp.getint("stt", "max_utter_ms", fallback=c.stt_max_utter_ms)
    return c


# ---------------------------------------------------------------------------
# Whisper parser
# ---------------------------------------------------------------------------
RE_WIMRELAY = re.compile(r"WIMRELAY<OWN:([^>]+)><(FROM|TO):([^>]+)><TS:[^>]*>(.*)", re.I)
RE_WIMBRIDGE = re.compile(r"\[?WIMBRIDGE\]?<OWN:([^>]+)><(FROM|TO):([^>]+)>(.*)", re.I)
RE_WHISPER_FROM_EN = re.compile(r"\[W From\]\s*\[([^\]]+)\]:\s*(.*)")
RE_WHISPER_TO_EN = re.compile(r"\[W To\]\s*\[([^\]]+)\]:\s*(.*)")
RE_WHISPER_DE = re.compile(r"\[De\]\s*\[([^\]]+)\]:\s*(.*)")
RE_WHISPER_PARA = re.compile(r"\[Para\]\s*\[([^\]]+)\]:\s*(.*)")
RE_WHISPERS_EN = re.compile(r"([\w\-\']+)\s+whispers:\s*(.*)")
RE_SUSSURRA = re.compile(r"([\w\-\']+)\s+sussurra:\s*(.*)")
RE_DE = re.compile(r"^De\s+([\w\-\']+):\s*(.*)")
RE_PARA = re.compile(r"^Para\s+([\w\-\']+):\s*(.*)")

WHISPER_HINT = re.compile(r"(WIMRELAY|WIMBRIDGE|whispers?:|sussurra:|\[W From\]|\[W To\]|\[De\]|\[Para\]|^De\s|^Para\s)", re.I)


@dataclass
class ParsedMessage:
    character: str
    player: str
    body: str
    direction: str  # incoming | outgoing


def parse_whisper(line: str, own_character: Optional[str] = None) -> Optional[ParsedMessage]:
    line = line.rstrip("\r\n")
    m = RE_WIMRELAY.search(line)
    if m:
        own, kind, other, body = m.group(1).strip(), m.group(2).upper(), m.group(3).strip(), m.group(4).strip()
        return ParsedMessage(own, other, body, "incoming" if kind == "FROM" else "outgoing")
    m = RE_WIMBRIDGE.search(line)
    if m:
        own, kind, other, body = m.group(1).strip(), m.group(2).upper(), m.group(3).strip(), m.group(4).strip()
        return ParsedMessage(own, other, body, "incoming" if kind == "FROM" else "outgoing")
    if own_character is None:
        return None
    m = RE_WHISPER_FROM_EN.search(line) or RE_WHISPER_DE.search(line)
    if m:
        return ParsedMessage(own_character, m.group(1).strip(), m.group(2).strip(), "incoming")
    m = RE_WHISPER_TO_EN.search(line) or RE_WHISPER_PARA.search(line)
    if m:
        return ParsedMessage(own_character, m.group(1).strip(), m.group(2).strip(), "outgoing")
    m = RE_WHISPERS_EN.search(line) or RE_SUSSURRA.search(line)
    if m:
        return ParsedMessage(own_character, m.group(1).strip(), m.group(2).strip(), "incoming")
    m = RE_DE.search(line)
    if m:
        return ParsedMessage(own_character, m.group(1).strip(), m.group(2).strip(), "incoming")
    m = RE_PARA.search(line)
    if m:
        return ParsedMessage(own_character, m.group(1).strip(), m.group(2).strip(), "outgoing")
    return None


# ---------------------------------------------------------------------------
# Chatlog tailing
# ---------------------------------------------------------------------------
def find_default_chatlog() -> Optional[str]:
    if not IS_WINDOWS:
        return None
    candidates = [
        r"C:\Program Files (x86)\World of Warcraft\_retail_\Logs\WoWChatLog.txt",
        r"C:\Program Files\World of Warcraft\_retail_\Logs\WoWChatLog.txt",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def tail_file(path: str, on_line):
    inode = None
    fh = None
    pos = 0
    while True:
        try:
            st = os.stat(path)
            if fh is None or st.st_ino != inode or st.st_size < pos:
                if fh:
                    try:
                        fh.close()
                    except Exception:
                        pass
                fh = open(path, "r", encoding="utf-8", errors="ignore")
                inode = st.st_ino
                fh.seek(0, os.SEEK_END)
                pos = fh.tell()
            fh.seek(pos)
            for raw in fh:
                on_line(raw)
            pos = fh.tell()
        except FileNotFoundError:
            time.sleep(1.0)
            continue
        except Exception:
            time.sleep(0.5)
        time.sleep(0.5)


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------
class Api:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def _headers(self):
        h = {"content-type": "application/json"}
        if self.cfg.bridge_token:
            h["authorization"] = f"Bearer {self.cfg.bridge_token}"
        return h

    def post(self, path: str, payload: dict):
        try:
            r = requests.post(self.cfg.base_url.rstrip("/") + path, json=payload, headers=self._headers(), timeout=15)
            return r
        except Exception as e:
            print(f"[api] POST {path} falhou: {e}", file=sys.stderr)
            return None

    def get(self, path: str, params: Optional[dict] = None):
        try:
            r = requests.get(self.cfg.base_url.rstrip("/") + path, params=params, headers=self._headers(), timeout=15)
            return r
        except Exception as e:
            print(f"[api] GET {path} falhou: {e}", file=sys.stderr)
            return None


# ---------------------------------------------------------------------------
# WoW window helpers (Windows only)
# ---------------------------------------------------------------------------
@dataclass
class WowWindow:
    hwnd: int
    pid: int
    title: str
    character: Optional[str] = None
    slot: Optional[str] = None
    realm: Optional[str] = None
    foreground: bool = False
    matched: bool = False


def enum_wow_windows() -> list[WowWindow]:
    if not IS_WINDOWS or win32gui is None:
        return []
    fg = win32gui.GetForegroundWindow()
    out: list[WowWindow] = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ""
        if "world of warcraft" not in title.lower() and "wow" not in title.lower():
            return
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
        except Exception:
            pid = 0
        out.append(WowWindow(hwnd=hwnd, pid=pid, title=title, foreground=(hwnd == fg)))

    win32gui.EnumWindows(cb, None)
    for i, w in enumerate(out):
        w.slot = f"wow{i+1}"
    return out


def focus_window(hwnd: int) -> bool:
    if not IS_WINDOWS or win32gui is None:
        return False
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def send_key(vk: int):
    if not IS_WINDOWS or win32api is None:
        return
    win32api.keybd_event(vk, 0, 0, 0)
    time.sleep(0.02)
    win32api.keybd_event(vk, 0, win32con.KEYEVENTF_KEYUP, 0)


def send_text_paste(text: str):
    if not IS_WINDOWS or pyperclip is None:
        return
    pyperclip.copy(text)
    time.sleep(0.05)
    # Ctrl+V
    win32api.keybd_event(0x11, 0, 0, 0)  # CTRL down
    win32api.keybd_event(0x56, 0, 0, 0)  # V down
    time.sleep(0.03)
    win32api.keybd_event(0x56, 0, win32con.KEYEVENTF_KEYUP, 0)
    win32api.keybd_event(0x11, 0, win32con.KEYEVENTF_KEYUP, 0)


VK_ENTER = 0x0D
VK_SPACE = 0x20
VK_ESCAPE = 0x1B


def send_whisper_in_window(w: WowWindow, target: str, body: str, cfg: Config) -> bool:
    if not IS_WINDOWS:
        return False
    if not focus_window(w.hwnd):
        return False
    # 1. Focar janela e aguardar
    time.sleep(cfg.focus_delay_ms / 1000.0)
    # 2. Enter para abrir chat
    send_key(VK_ENTER)
    time.sleep(cfg.chat_open_delay_ms / 1000.0)
    # 3. /w nome-server
    send_text_paste(f"/w {target}")
    time.sleep(cfg.chat_send_delay_ms / 1000.0)
    # 4. Espaço (WIM requer para abrir o whisper)
    send_key(VK_SPACE)
    time.sleep(cfg.chat_send_delay_ms / 1000.0)
    # 5. corpo da mensagem
    send_text_paste(body)
    time.sleep(cfg.chat_send_delay_ms / 1000.0)
    # 6. Enter para enviar
    send_key(VK_ENTER)
    time.sleep(cfg.after_send_delay_ms / 1000.0)
    # 7. Fechar chat (ESC) opcional
    if cfg.close_chat_enabled:
        send_key(VK_ESCAPE)
        time.sleep(cfg.chat_close_delay_ms / 1000.0)
    return True


# ---------------------------------------------------------------------------
# Main bridge loop
# ---------------------------------------------------------------------------
class Bridge:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.api = Api(cfg)
        self.windows: list[WowWindow] = []
        self.settings: dict = {}
        self.stop_event = threading.Event()

    def start(self):
        chatlog = self.cfg.chatlog_path or find_default_chatlog() or ""
        if chatlog:
            print(f"[bridge] tail chatlog: {chatlog}")
            threading.Thread(target=self._tail_thread, args=(chatlog,), daemon=True).start()
        else:
            print("[bridge] chatlog_path não configurado — leitura desabilitada.")
        threading.Thread(target=self._scan_thread, daemon=True).start()
        threading.Thread(target=self._queue_thread, daemon=True).start()
        threading.Thread(target=self._settings_thread, daemon=True).start()
        if self.cfg.stt_enabled:
            self._start_stt()
        try:
            while not self.stop_event.is_set():
                time.sleep(0.5)
        except KeyboardInterrupt:
            print("\n[bridge] parando...")

    def _tail_thread(self, path: str):
        def on_line(raw: str):
            msg = parse_whisper(raw)
            if msg is None:
                if WHISPER_HINT.search(raw):
                    print(f"🔎 linha com cara de whisper não parseada: {raw.strip()}")
                return
            ext_id = f"{msg.character}::{msg.player}::{msg.direction}::{int(time.time()*1000)}::{hash(msg.body) & 0xffff}"
            arrow = "←" if msg.direction == "incoming" else "→"
            print(f"{arrow} [{msg.character}] {msg.player}: {msg.body}")
            self.api.post("/api/ingest", {
                "messages": [
                    {
                        "externalId": ext_id,
                        "character": msg.character,
                        "player": msg.player,
                        "body": msg.body,
                        "direction": msg.direction,
                        "status": "received" if msg.direction == "incoming" else "sent",
                    }
                ]
            })
        tail_file(path, on_line)

    def _scan_thread(self):
        while not self.stop_event.is_set():
            self.windows = enum_wow_windows()
            payload = {"windows": [
                {
                    "character": w.character,
                    "windowTitle": w.title,
                    "pid": w.pid,
                    "hwnd": w.hwnd,
                    "foreground": w.foreground,
                    "matched": w.matched,
                    "slot": w.slot,
                    "realm": w.realm,
                }
                for w in self.windows
            ]}
            self.api.post("/api/status/scan", payload)
            time.sleep(self.cfg.scan_ms / 1000.0)

    def _find_window_for(self, character: str) -> Optional[WowWindow]:
        cl = character.lower()
        for w in self.windows:
            if w.character and w.character.lower() == cl:
                return w
        # fallback: pick foreground
        for w in self.windows:
            if w.foreground:
                return w
        return None

    def _queue_thread(self):
        while not self.stop_event.is_set():
            r = self.api.get("/api/queue", params={"limit": 10})
            if r is not None and r.ok:
                data = r.json() or {}
                queue = data.get("queue") or []
                for item in queue:
                    self._process_outgoing(item)
            time.sleep(self.cfg.queue_poll_ms / 1000.0)

    def _process_outgoing(self, item: dict):
        mid = item.get("id")
        character = item.get("character") or ""
        player = item.get("player") or ""
        body = item.get("body") or ""
        w = self._find_window_for(character)
        if not w:
            print(f"[queue] sem janela para {character}, aguardando...")
            return
        ok = False
        err = None
        try:
            ok = send_whisper_in_window(w, player, body, self.cfg)
        except Exception as e:
            err = str(e)
        payload = {"status": "sent" if ok else "failed"}
        if err:
            payload["error"] = err
        self.api.post(f"/api/queue/{mid}/ack", payload)

    def _settings_thread(self):
        while not self.stop_event.is_set():
            r = self.api.get("/api/control")
            if r is not None and r.ok:
                data = r.json() or {}
                self.settings = data.get("settings") or {}
            time.sleep(2.0)

    # ---------------- STT (text-to-speech do addon -> loopback -> whisper) -----------
    def _guess_own_character(self) -> str:
        if self.cfg.stt_own_character:
            return self.cfg.stt_own_character
        # 1. janela em foreground que casou com personagem
        for w in self.windows:
            if w.foreground and w.character:
                return w.character
        # 2. qualquer janela com character
        for w in self.windows:
            if w.character:
                return w.character
        # 3. primeiro slot
        if self.windows:
            return self.windows[0].character or "unknown"
        return "unknown"

    def _start_stt(self):
        try:
            import wim_bridge_stt as stt_mod  # type: ignore
        except Exception as e:
            print(f"[stt] módulo wim_bridge_stt.py não encontrado: {e}")
            return
        stt_cfg = stt_mod.SttConfig(
            enabled=True,
            model=self.cfg.stt_model,
            device=self.cfg.stt_device,
            compute_type=self.cfg.stt_compute,
            language=self.cfg.stt_language,
            device_name=self.cfg.stt_device_name,
            rms_threshold=self.cfg.stt_rms_threshold,
            silence_ms=self.cfg.stt_silence_ms,
            max_utter_ms=self.cfg.stt_max_utter_ms,
        )
        print(f"[stt] iniciando · modelo={stt_cfg.model} idioma={stt_cfg.language}")
        pipe = stt_mod.SttPipeline(
            stt_cfg,
            own_character_provider=self._guess_own_character,
            on_message=self._on_stt_message,
            log=print,
        )
        pipe.start()
        self._stt_pipeline = pipe

    def _on_stt_message(self, msg):
        # msg é wim_bridge_stt.SttMessage
        ext_id = f"stt::{msg.character}::{msg.player}::{msg.direction}::{int(time.time()*1000)}::{hash(msg.body) & 0xffff}"
        arrow = "🔊←" if msg.direction == "incoming" else "🔊→"
        print(f"{arrow} [{msg.character}] {msg.player}: {msg.body}")
        self.api.post("/api/ingest", {
            "messages": [
                {
                    "externalId": ext_id,
                    "character": msg.character,
                    "player": msg.player,
                    "body": msg.body,
                    "direction": msg.direction,
                    "status": "received" if msg.direction == "incoming" else "sent",
                }
            ]
        })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.ini")
    ap.add_argument("--url", default=None, help="sobrescreve base_url")
    ap.add_argument("--token", default=None, help="sobrescreve bridge_token")
    args = ap.parse_args()
    cfg = load_config(args.config)
    if args.url:
        cfg.base_url = args.url
    if args.token is not None:
        cfg.bridge_token = args.token
    print(f"[bridge] Bakers Whisper bridge · base_url={cfg.base_url}")
    Bridge(cfg).start()


if __name__ == "__main__":
    main()
