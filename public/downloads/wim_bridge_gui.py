"""
Bakers Whisper — GUI Bridge (single-executable version)
========================================================

Aplicativo Windows que faz a ponte entre o(s) cliente(s) do WoW abertos no
PC do usuário e o painel web hospedado no Vercel.

- Sem necessidade de configurar nada: URL e token vêm embutidos.
- Detecta automaticamente todas as janelas do WoW abertas.
- Deriva o caminho do WoWChatLog.txt a partir do processo (psutil).
- Interface simples em tkinter: usuário só digita o nome do personagem
  de cada janela.
- Roda o bridge em threads em segundo plano.

Empacotado em .exe via PyInstaller pelo GitHub Actions (workflow em
.github/workflows/build-windows.yml).
"""

from __future__ import annotations

# =============================================================================
# CONSTANTES DE BUILD — editadas antes de compilar o executável
# =============================================================================
API_URL = "https://wimmsg-lntm.vercel.app"
BRIDGE_TOKEN = "REPLACE_WITH_YOUR_TOKEN"
APP_NAME = "Bakers Whisper"
APP_VERSION = "1.4.8"
# =============================================================================

import hashlib
import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk
from datetime import datetime, timezone
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from tkinter import messagebox, scrolledtext, ttk
from typing import Optional

import requests

# Optional voice relay: the addon SPEAKS each whisper (names spelled with the
# NATO phonetic alphabet so they are never misheard) and the bridge listens on
# the microphone, transcribes and posts to the site — completely independent
# from WoWChatLog.txt.
try:
    import speech_recognition as sr  # type: ignore

    HAS_SPEECH = True
except Exception:  # pragma: no cover - library optional
    sr = None  # type: ignore
    HAS_SPEECH = False

# Loopback audio capture: records what the PC is PLAYING (the addon's TTS
# narration) without needing a microphone at all (WASAPI loopback).
try:
    import soundcard as sc  # type: ignore
    import numpy as np  # type: ignore

    HAS_LOOPBACK = True
except Exception:  # pragma: no cover
    sc = None  # type: ignore
    np = None  # type: ignore
    HAS_LOOPBACK = False

# Screen OCR fallback: screenshot the relay frame drawn by the addon and read
# it with the Windows built-in OCR engine (winocr).
try:
    import mss  # type: ignore

    HAS_MSS = True
except Exception:  # pragma: no cover
    mss = None  # type: ignore
    HAS_MSS = False

try:
    import winocr  # type: ignore

    HAS_WINOCR = True
except Exception:  # pragma: no cover
    winocr = None  # type: ignore
    HAS_WINOCR = False


def winocr_pil_text(pil_image, lang: str = "en-US") -> str:
    """
    Compatibility wrapper for different `winocr` package versions.

    Some old/internal Bakers Whisper builds called:
        winocr.recognize_pil_image(img, "pt-BR")

    But the public PyPI/GitHub `winocr` package exposes:
        winocr.recognize_pil(img, "pt")
        winocr.recognize_pil_sync(img, "pt")

    This wrapper tries all known APIs and both full Windows locale (pt-BR)
    and base language (pt), preventing the runtime error:
        module 'winocr' has no attribute 'recognize_pil_image'
    """
    if not HAS_WINOCR or winocr is None:
        raise RuntimeError("winocr indisponível")

    import inspect
    import asyncio

    def extract_text(result) -> str:
        if result is None:
            return ""
        if isinstance(result, dict):
            return str(result.get("text") or "")
        text = getattr(result, "text", None)
        if text is not None:
            return str(text)
        return str(result)

    langs = []
    if lang:
        langs.append(lang)
        base = lang.split("-", 1)[0]
        if base and base not in langs:
            langs.append(base)
    if "en" not in langs:
        langs.append("en")

    func_names = (
        "recognize_pil_image",  # custom gist / old bundled helper
        "recognize_pil",        # public winocr async API
        "recognize_pil_sync",   # public winocr sync API
    )

    last_error: Exception | None = None
    available = [name for name in func_names if hasattr(winocr, name)]
    if not available:
        raise AttributeError(
            "winocr instalado não possui recognize_pil_image/recognize_pil/recognize_pil_sync"
        )

    for name in available:
        fn = getattr(winocr, name)
        for candidate_lang in langs:
            try:
                result = fn(pil_image, candidate_lang)
                if inspect.isawaitable(result):
                    result = asyncio.run(result)
                return extract_text(result)
            except Exception as exc:
                last_error = exc
                continue

    raise RuntimeError(f"winocr falhou em todas as APIs/idiomas: {last_error}")

try:
    import psutil  # type: ignore
    HAS_PSUTIL = True
except Exception:
    HAS_PSUTIL = False

try:
    import pydirectinput  # type: ignore
    pydirectinput.PAUSE = 0.0
    HAS_PYDIRECTINPUT = True
except Exception:
    HAS_PYDIRECTINPUT = False

try:
    import pyautogui  # type: ignore
    pyautogui.FAILSAFE = False
    HAS_PYAUTOGUI = True
except Exception:
    HAS_PYAUTOGUI = False

try:
    import win32gui  # type: ignore
    import win32con  # type: ignore
    import win32process  # type: ignore
    HAS_WIN32 = True
except Exception:
    HAS_WIN32 = False


# =============================================================================
# App data folder (%APPDATA%/BakersWhisper on Windows)
# =============================================================================
def app_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home())))
    else:
        base = Path.home() / ".config"
    d = base / "BakersWhisper"
    d.mkdir(parents=True, exist_ok=True)
    return d


CONFIG_FILE = app_data_dir() / "config.json"


# =============================================================================
# Persistent config (server settings + character mappings)
# =============================================================================
@dataclass
class ServerSettings:
    api_url: str = API_URL
    token: str = BRIDGE_TOKEN


@dataclass
class AppConfig:
    server: ServerSettings = field(default_factory=ServerSettings)
    mappings: dict[str, "SavedMapping"] = field(default_factory=dict)


@dataclass
class SavedMapping:
    """
    Persisted per slot (wow1, wow2, ...), not per exe_path.

    Important: many users run multiple WoW windows from the SAME installation
    folder. If we key by exe_path, every window overwrites the same character.
    So the stable identity is now the assigned slot number.
    """
    exe_path: str
    slot: int
    character: str


def load_config() -> AppConfig:
    if not CONFIG_FILE.exists():
        return AppConfig()
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        server_data = data.get("server", {})
        server = ServerSettings(
            api_url=server_data.get("api_url") or API_URL,
            token=server_data.get("token") or BRIDGE_TOKEN,
        )
        mappings: dict[str, SavedMapping] = {}
        for key, item in data.get("mappings", {}).items():
            if "exe_path" in item:
                m = SavedMapping(**item)
                # New format: always key by slot:N. Old configs keyed by exe_path
                # are migrated if they contain slot.
                if m.slot:
                    mappings[f"slot:{m.slot}"] = m
                else:
                    mappings[key] = m
        return AppConfig(server=server, mappings=mappings)
    except Exception:
        return AppConfig()


def save_config(config: AppConfig) -> None:
    payload = {
        "server": config.server.__dict__,
        "mappings": {k: m.__dict__ for k, m in config.mappings.items()},
    }
    CONFIG_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def realm_of(character: str) -> str:
    """'Aragorn-Nemesis' -> 'Nemesis'; 'Aragorn' -> '' (unknown realm)."""
    if not character or "-" not in character:
        return ""
    return character.rsplit("-", 1)[1].strip()


# =============================================================================
# API client
# =============================================================================
class ApiClient:
    def __init__(self, api_url: str = API_URL, token: str = BRIDGE_TOKEN) -> None:
        self.s = requests.Session()
        self.api_url = api_url.rstrip("/")
        self.token = token.strip()
        self._apply_headers()

    def _apply_headers(self) -> None:
        self.s.headers.clear()
        if self.token and self.token != "REPLACE_WITH_YOUR_TOKEN":
            self.s.headers["Authorization"] = f"Bearer {self.token}"
        self.s.headers["content-type"] = "application/json"
        self.s.headers["user-agent"] = f"{APP_NAME}/{APP_VERSION}"

    def update_server(self, api_url: str, token: str) -> None:
        self.api_url = api_url.rstrip("/")
        self.token = token.strip()
        self._apply_headers()

    def _url(self, p: str) -> str:
        return f"{self.api_url}{p}"

    def ingest(self, msgs: list[dict]) -> int:
        if not msgs:
            return 0
        r = self.s.post(self._url("/api/ingest"), json={"messages": msgs}, timeout=15)
        r.raise_for_status()
        return int(r.json().get("inserted", 0))

    def fetch_queue(self) -> list[dict]:
        r = self.s.get(self._url("/api/queue"), timeout=15)
        r.raise_for_status()
        return r.json().get("messages", [])

    def ack(self, mid: int, status: str, error: Optional[str] = None) -> None:
        payload: dict = {"status": status}
        if error:
            payload["error"] = error
        r = self.s.post(self._url(f"/api/queue/{mid}/ack"), json=payload, timeout=15)
        r.raise_for_status()

    def scan(self, windows: list[dict]) -> None:
        r = self.s.post(
            self._url("/api/status/scan"),
            json={
                "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "windows": windows,
            },
            timeout=15,
        )
        r.raise_for_status()

    def gse_states(self) -> list[dict]:
        r = self.s.get(self._url("/api/gse"), timeout=10)
        r.raise_for_status()
        return r.json().get("states", [])

    def controls(self) -> dict:
        r = self.s.get(self._url("/api/control"), timeout=10)
        r.raise_for_status()
        return r.json().get("controls", {})

    def sync(self, msgs: list[dict]) -> int:
        """Send historical messages (from log file at startup)."""
        if not msgs:
            return 0
        r = self.s.post(self._url("/api/sync"), json={"messages": msgs}, timeout=15)
        r.raise_for_status()
        return int(r.json().get("inserted", 0))

    def health(self) -> tuple[bool, str]:
        """Return (ok, human_message) for UI/log diagnostics."""
        try:
            url = self._url("/api/health")
            r = self.s.get(url, timeout=8)
            if not r.ok:
                text = r.text[:500]
                return False, f"health HTTP {r.status_code}: {text}"
            try:
                data = r.json()
            except Exception:
                return True, "health OK (non-json response)"
            if data.get("ok") is True:
                return True, "health OK"
            return False, f"health respondeu ok=false: {data}"
        except Exception as e:
            return False, f"health falhou: {type(e).__name__}: {e}"

    def auth_check(self) -> tuple[bool, str]:
        """Check an authenticated bridge endpoint so token problems are obvious."""
        try:
            r = self.s.get(self._url("/api/queue"), timeout=8)
            if r.status_code == 401:
                return False, "token inválido ou ausente (401 unauthorized)"
            if not r.ok:
                return False, f"queue HTTP {r.status_code}: {r.text[:300]}"
            return True, "token/API OK"
        except Exception as e:
            return False, f"queue falhou: {type(e).__name__}: {e}"


# =============================================================================
# WoW window detection
# =============================================================================
WOW_TITLE_HINTS = ("world of warcraft", "wow")
WOW_EXE_HINTS = ("wow.exe", "wowclassic.exe")


@dataclass
class DetectedWindow:
    hwnd: int
    pid: int
    title: str
    exe_path: str = ""
    chat_log: str = ""
    foreground: bool = False
    slot: int = 0  # wowN number assigned by the bridge


def _pid_for_hwnd(hwnd: int) -> int:
    try:
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        return int(pid)
    except Exception:
        return 0


def _exe_for_pid(pid: int) -> str:
    if not HAS_PSUTIL or not pid:
        return ""
    try:
        return psutil.Process(pid).exe()
    except Exception:
        return ""


def _log_from_exe(exe_path: str) -> str:
    """
    Derives WoWChatLog.txt path from Wow.exe path.
    Typical: C:/.../World of Warcraft/_retail_/Wow.exe
             → C:/.../World of Warcraft/_retail_/Logs/WoWChatLog.txt
    """
    if not exe_path:
        return ""
    p = Path(exe_path).parent / "Logs" / "WoWChatLog.txt"
    return str(p)


def enum_wow_windows() -> list[DetectedWindow]:
    if not HAS_WIN32:
        return []
    results: list[DetectedWindow] = []
    try:
        fg = win32gui.GetForegroundWindow()
    except Exception:
        fg = 0

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = (win32gui.GetWindowText(hwnd) or "").strip()
        if not title:
            return
        low = title.lower()
        pid = _pid_for_hwnd(hwnd)
        exe = _exe_for_pid(pid) if pid else ""
        exe_name = Path(exe).name.lower() if exe else ""

        # Prefer process executable detection. This avoids detecting browser
        # tabs/pages/editors containing the word "wow".
        looks_wow_by_exe = exe_name in WOW_EXE_HINTS

        # Fallback only if psutil/exe lookup failed: very strict title match.
        # Accept official "World of Warcraft" and our own renamed "wowN" slots.
        looks_wow_by_title = (
            low == "world of warcraft"
            or re.fullmatch(r"wow\d+", low) is not None
        )

        if not looks_wow_by_exe and not (not exe and looks_wow_by_title):
            return

        results.append(
            DetectedWindow(
                hwnd=int(hwnd),
                pid=pid,
                title=title,
                exe_path=exe,
                chat_log=_log_from_exe(exe),
                foreground=(hwnd == fg),
            )
        )

    win32gui.EnumWindows(cb, None)
    # Deterministic ordering helps stable slot assignment before windows are
    # renamed. PID tends to follow launch order; hwnd is fallback.
    results.sort(key=lambda w: (w.pid or 0, w.hwnd))
    return results


def focus_hwnd(hwnd: int) -> bool:
    """
    Robust focus. A plain SetForegroundWindow often fails because Windows only
    allows the *foreground* process to steal focus, and because WoW windows are
    recreated (new HWND) after restarts. We use the Alt-key trick + thread
    input attach, restore if minimized, and verify with GetForegroundWindow.
    """
    if not HAS_WIN32:
        return False
    try:
        if not win32gui.IsWindow(hwnd):
            return False
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

        fore = win32gui.GetForegroundWindow()
        if fore and fore != hwnd:
            attached = False
            fore_tid = 0
            cur_tid = 0
            try:
                import win32api  # type: ignore
                import win32process  # type: ignore

                fore_tid = win32process.GetWindowThreadProcessId(fore)[0]
                cur_tid = win32api.GetCurrentThreadId()
                if fore_tid and fore_tid != cur_tid:
                    attached = bool(
                        win32process.AttachThreadInput(cur_tid, fore_tid, True)
                    )
            except Exception:
                attached = False
            try:
                try:
                    import win32api  # type: ignore

                    win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
                except Exception:
                    pass
                win32gui.SetForegroundWindow(hwnd)
            finally:
                try:
                    import win32api  # type: ignore

                    win32api.keybd_event(
                        win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0
                    )
                except Exception:
                    pass
                if attached:
                    try:
                        import win32process  # type: ignore

                        win32process.AttachThreadInput(cur_tid, fore_tid, False)
                    except Exception:
                        pass
        else:
            win32gui.SetForegroundWindow(hwnd)

        try:
            win32gui.BringWindowToTop(hwnd)
        except Exception:
            pass

        for _ in range(12):
            if win32gui.GetForegroundWindow() == hwnd:
                return True
            time.sleep(0.1)
        return False
    except Exception:
        return False


def rename_hwnd(hwnd: int, new_title: str) -> bool:
    """Rename a window using SetWindowText. Works on WoW's main window."""
    if not HAS_WIN32:
        return False
    try:
        win32gui.SetWindowText(hwnd, new_title)
        return True
    except Exception:
        return False


def assign_slots(
    wins: list[DetectedWindow], saved: dict[str, SavedMapping]
) -> dict[int, int]:
    """
    Decide the wowN slot number for each detected window.

    Priority:
      1) If current window title is already wowN, keep N.
      2) Otherwise assign the smallest free slot by deterministic window order.

    We deliberately DO NOT key by exe_path because many windows may share the
    same Wow.exe path.
    """
    used: set[int] = set()
    result: dict[int, int] = {}

    # Pass 1 — preserve current wowN title if present.
    for w in wins:
        m = re.fullmatch(r"wow(\d+)", w.title.strip().lower())
        if m:
            slot = int(m.group(1))
            if slot > 0 and slot not in used:
                result[w.hwnd] = slot
                used.add(slot)

    # Pass 2 — assign fresh slots.
    def next_free() -> int:
        n = 1
        while n in used:
            n += 1
        used.add(n)
        return n

    for w in wins:
        if w.hwnd not in result:
            result[w.hwnd] = next_free()
    return result


def apply_renames(wins: list[DetectedWindow], slots: dict[int, int]) -> int:
    """Rename each window to 'wowN'. Returns count of successful renames."""
    ok = 0
    for w in wins:
        slot = slots.get(w.hwnd)
        if slot is None:
            continue
        target = f"wow{slot}"
        current = w.title
        if current == target:
            continue
        if rename_hwnd(w.hwnd, target):
            w.title = target  # keep the in-memory record in sync
            ok += 1
    return ok


# --------------------------------------------------------------------------
# Background keypress via PostMessage (no focus stealing)
# --------------------------------------------------------------------------
# Rough VK code map for the common GSE keybinds. Extend as needed.
_VK_MAP: dict[str, int] = {
    # Digits
    **{str(d): 0x30 + d for d in range(10)},
    # Letters
    **{chr(c): c for c in range(ord("A"), ord("Z") + 1)},
    # F1..F12
    **{f"F{i}": 0x70 + (i - 1) for i in range(1, 13)},
    # Numpad
    **{f"NUMPAD{i}": 0x60 + i for i in range(10)},
    "SPACE": 0x20,
    "ENTER": 0x0D,
    "TAB": 0x09,
    "ESC": 0x1B,
    "SHIFT": 0x10,
    "CTRL": 0x11,
    "ALT": 0x12,
    "-": 0xBD,
    "=": 0xBB,
    "[": 0xDB,
    "]": 0xDD,
    "`": 0xC0,
}


def key_to_vk(key: str) -> int:
    if not key:
        return 0
    k = key.strip().upper()
    return _VK_MAP.get(k, 0)


WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101


def post_key_to_hwnd(hwnd: int, vk: int) -> bool:
    """
    Send WM_KEYDOWN + WM_KEYUP to a window WITHOUT stealing focus.

    Works fine for chat/UI keybinds in WoW; may or may not work for spell
    casts depending on how the client filters input. In practice GSE macros
    triggered via keybinds respond to PostMessage in most WoW clients.
    """
    if not HAS_WIN32 or not vk:
        return False
    try:
        import win32api  # type: ignore
        scan = win32api.MapVirtualKey(vk, 0)
        lparam_down = (scan << 16) | 1
        lparam_up = (scan << 16) | (1 | (1 << 30) | (1 << 31))
        win32gui.PostMessage(hwnd, WM_KEYDOWN, vk, lparam_down)
        win32gui.PostMessage(hwnd, WM_KEYUP, vk, lparam_up)
        return True
    except Exception:
        return False


def set_clipboard_text(text: str) -> bool:
    """
    Copy `text` to the Windows clipboard (pywin32 is already a dependency for
    window enumeration). Used by the whisper sender to paste the command
    atomically instead of typing char-by-char — this fixes "cut" messages
    where the first keystrokes were eaten because the chat box wasn't ready.
    """
    try:
        import win32clipboard  # type: ignore
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        finally:
            win32clipboard.CloseClipboard()
        return True
    except Exception:
        return False


def paste_ctrl_v() -> bool:
    """Press Ctrl+V (paste) with whichever input library is available."""
    try:
        if HAS_PYDIRECTINPUT:
            pydirectinput.keyDown("ctrl")
            pydirectinput.press("v")
            pydirectinput.keyUp("ctrl")
        else:
            pyautogui.hotkey("ctrl", "v")
        return True
    except Exception:
        return False


def press_key(name: str) -> None:
    """Press a single key with the active input library."""
    if HAS_PYDIRECTINPUT:
        pydirectinput.press(name)
    else:
        pyautogui.press(name)


# --------------------------------------------------------------------------
# GSE spammer — one thread per character, pausable during whisper sends
# --------------------------------------------------------------------------
class GseSpammer:
    """
    Sends the configured GSE keybind at `interval_ms` intervals to a single
    WoW window in the background (no focus needed).

    Exposes:
      - `pause_event`  : set() to suspend spam (used by the whisper sender)
      - `stop()`       : terminate the thread
      - `update(...)`  : change keybind/interval on the fly
    """

    def __init__(self, character: str, hwnd: int, keybind: str, interval_ms: int, log_cb):
        self.character = character
        self.hwnd = hwnd
        self.keybind = keybind
        self.interval_ms = max(50, min(2000, int(interval_ms)))
        self.log = log_cb
        self.pause_event = threading.Event()  # SET = paused
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def update(self, keybind: str, interval_ms: int) -> None:
        self.keybind = keybind
        self.interval_ms = max(50, min(2000, int(interval_ms)))

    def _run(self) -> None:
        self.log(f"⚙ GSE [{self.character}] iniciado — tecla {self.keybind!r}")
        while not self._stop.is_set():
            if self.pause_event.is_set():
                time.sleep(0.05)
                continue
            vk = key_to_vk(self.keybind)
            if vk:
                post_key_to_hwnd(self.hwnd, vk)
            # sleep in small increments so stop/pause react fast
            slept = 0.0
            step = 0.02
            target = self.interval_ms / 1000.0
            while slept < target and not self._stop.is_set() and not self.pause_event.is_set():
                time.sleep(step)
                slept += step
        self.log(f"⚙ GSE [{self.character}] parado.")


# =============================================================================
# Whisper log parser
# =============================================================================
# Tolerant timestamp: retail writes "10/8 12:34:56.789", older clients may
# omit the milliseconds (or even the year).
TIMESTAMP_RE = re.compile(r"^\d+/\d+(?:/\d+)?\s+\d+:\d+:\d+(?:\.\d+)?\s+")
ADDON_RE = re.compile(
    r"\[WIMBRIDGE\]<OWN:(?P<own>[^>]+)><FROM:(?P<from>[^>]+)>(?P<body>.*)$"
)
ADDON_TO_RE = re.compile(
    r"\[WIMBRIDGE\]<OWN:(?P<own>[^>]+)><TO:(?P<to>[^>]+)>(?P<body>.*)$"
)
# Some builds/addon versions relay through a compact WIMRELAY marker instead
# of [WIMBRIDGE]. Accept it anywhere in the log line, including after a private
# channel prefix: "[4. BWxxx] [Me]: WIMRELAY<OWN:Me><FROM:Them><TS:...>body".
RELAY_FROM_RE = re.compile(
    r"(?:WIMRELAY|BWRELAY)?\s*<\s*OWN\s*:\s*(?P<own>[^>]+?)\s*>\s*<\s*FROM\s*:\s*(?P<from>[^>]+?)\s*>\s*(?:<\s*TS\s*:\s*(?P<ts>[^>]+?)\s*>\s*)?(?P<body>.*)$",
    re.IGNORECASE | re.DOTALL,
)
RELAY_TO_RE = re.compile(
    r"(?:WIMRELAY|BWRELAY)?\s*<\s*OWN\s*:\s*(?P<own>[^>]+?)\s*>\s*<\s*TO\s*:\s*(?P<to>[^>]+?)\s*>\s*(?:<\s*TS\s*:\s*(?P<ts>[^>]+?)\s*>\s*)?(?P<body>.*)$",
    re.IGNORECASE | re.DOTALL,
)


def _normalize_relay_ocr(text: str) -> str:
    """Normalize common OCR distortions of the addon relay strip."""
    clean = text.replace("‹", "<").replace("＜", "<").replace("«", "<")
    clean = clean.replace("›", ">").replace("＞", ">").replace("»", ">")
    clean = clean.replace("WIM RELAY", "WIMRELAY").replace("BW RELAY", "BWRELAY")
    clean = re.sub(r"WIM\s*RELAY", "WIMRELAY", clean, flags=re.IGNORECASE)
    clean = re.sub(r"BW\s*RELAY", "BWRELAY", clean, flags=re.IGNORECASE)
    return clean
# WoW's NATIVE chat log lines for whispers (work even WITHOUT the addon,
# as long as /chatlog is on):
#   [W From] [Sender-Realm]: message
#   [W To]   [Recipient-Realm]: message
# Localized clients / WIM can produce variants like:
#   [De] [Sender-Realm]: message
#   [Para] [Recipient-Realm]: message
#   [Sussurro de] [Sender-Realm]: message
#   Sender-Realm sussurra: message
NATIVE_TAG_RE = re.compile(
    r"^\[(?P<kind>W From|W To|From|To|De|Para|Sussurro de|Sussurro para|Whisper From|Whisper To)\]\s+(?P<rest>.*)$",
    re.IGNORECASE,
)
NATIVE_NAME_RE = re.compile(
    r"^(?:\[(?P<name>[^\]]+)\]|(?P<name2>[A-Za-zÀ-ÿ0-9_'\-]+)):\s*(?P<body>.*)$"
)
PLAYER_PAT = r"[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?"
FALLBACKS_IN = [
    # English native WoW variants
    re.compile(rf"^(?P<from>{PLAYER_PAT})\s+whispers?(?:\s+to\s+you)?:\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(rf"^(?:From|Whisper\s+From)\s+(?P<from>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
    # Portuguese native WoW variants
    re.compile(rf"^(?P<from>{PLAYER_PAT})\s+sussurra(?:\s+para\s+você)?:\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(rf"^(?P<from>{PLAYER_PAT})\s+te\s+sussurra:\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(rf"^De\s+(?P<from>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(rf"^Sussurro\s+de\s+(?P<from>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
    # WIM-style visual copy/log snippets: "12:34 [Player]: body"
    re.compile(rf"^(?:\d{{1,2}}:\d{{2}}\s*)?(?P<from>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
]
FALLBACKS_OUT = [
    re.compile(rf"^(?:To|Para|Whisper\s+To|Sussurro\s+para)\s+(?P<to>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(rf"^Você\s+sussurra\s+para\s+(?P<to>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(rf"^You\s+whisper\s+to\s+(?P<to>{PLAYER_PAT}):\s+(?P<body>.+)$", re.IGNORECASE),
]


def _strip_wow_markup(text: str) -> str:
    """Remove WoW color codes / item links so bodies stay readable."""
    clean = re.sub(r"\|c[0-9a-fA-F]{8}", "", text)
    clean = re.sub(r"\|H[^|]*\|h", "", clean)
    clean = clean.replace("|h", "").replace("|r", "")
    return clean.strip()


def parse_whisper(line: str, own_default: str) -> Optional[tuple[str, str, str, str]]:
    """
    Returns (direction, character, player, body) or None.
      direction  : "incoming" (window received) | "outgoing" (window sent)
      character  : YOUR character (the window that owns this log line)
      player     : the other side
      body       : message text (markup stripped)
    """
    raw = line.rstrip("\r\n")
    stripped = TIMESTAMP_RE.sub("", raw).strip()
    if not stripped:
        return None

    addon_clean = _normalize_relay_ocr(_strip_wow_markup(stripped))
    # The addon may relay through a private WoW channel, so the chat log line
    # can contain a prefix like "[4. BWRealm123] [Player]: " before the
    # [WIMBRIDGE] marker. Use search(), not match().
    m = ADDON_RE.search(addon_clean)
    if m:
        own = m.group("own").strip() or own_default
        return (
            "incoming",
            own,
            m.group("from").strip(),
            m.group("body").strip(),
        )

    m = ADDON_TO_RE.search(addon_clean)
    if m:
        own = m.group("own").strip() or own_default
        return (
            "outgoing",
            own,
            m.group("to").strip(),
            m.group("body").strip(),
        )

    m = RELAY_FROM_RE.search(addon_clean)
    if m:
        own = m.group("own").strip() or own_default
        return (
            "incoming",
            own,
            m.group("from").strip(),
            m.group("body").strip(),
        )

    m = RELAY_TO_RE.search(addon_clean)
    if m:
        own = m.group("own").strip() or own_default
        return (
            "outgoing",
            own,
            m.group("to").strip(),
            m.group("body").strip(),
        )

    clean = _strip_wow_markup(stripped)

    tag = NATIVE_TAG_RE.match(clean)
    if tag:
        name_m = NATIVE_NAME_RE.match(tag.group("rest"))
        if name_m:
            other = (name_m.group("name") or name_m.group("name2") or "").strip()
            body = name_m.group("body").strip()
            if other:
                kind = tag.group("kind").lower()
                if kind in ("w from", "from", "de", "sussurro de", "whisper from"):
                    return "incoming", own_default, other, body
                return "outgoing", own_default, other, body

    # Legacy/WIM fallbacks: strip brackets so "[Name-Realm] whispers: body"
    # also matches. These catch many localized client variations.
    clean_nobrackets = clean.replace("[", "").replace("]", "")
    for pat in FALLBACKS_IN:
        m = pat.match(clean_nobrackets)
        if m:
            return "incoming", own_default, m.group("from").strip(), m.group("body").strip()
    for pat in FALLBACKS_OUT:
        m = pat.match(clean_nobrackets)
        if m:
            return "outgoing", own_default, m.group("to").strip(), m.group("body").strip()
    return None


# =============================================================================
# Voice relay parser (NATO phonetic alphabet)
# =============================================================================
# The addon speaks:
#   "Wimbridge. Own <nato-name>. From <nato-name>. Message <body>. Endbridge."
# Names are spelled with NATO words so speech-to-text never mangles them.
NATO_TO_CHAR = {
    "alpha": "a", "alfa": "a", "bravo": "b", "charlie": "c", "delta": "d",
    "echo": "e", "eko": "e", "foxtrot": "f", "golf": "g", "hotel": "h",
    "india": "i", "juliet": "j", "juliett": "j", "kilo": "k", "lima": "l",
    "mike": "m", "november": "n", "oscar": "o", "papa": "p", "quebec": "q",
    "romeo": "r", "sierra": "s", "tango": "t", "uniform": "u", "victor": "v",
    "whiskey": "w", "xray": "x", "yankee": "y", "zulu": "z",
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "niner": "9", "dash": "-", "hyphen": "-",
}


def parse_voice_transcript(text: str) -> Optional[tuple[str, str, str, str]]:
    """
    Returns (direction, own, other, body) from a spoken relay line, or None.
    """
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    if not words:
        return None

    def idx_after(start: int, markers: set) -> int:
        for i in range(start, len(words)):
            if words[i] in markers:
                return i
        return -1

    head = idx_after(0, {"wimbridge", "wim"})
    if head < 0:
        return None
    own_i = idx_after(head, {"own"})
    if own_i < 0:
        return None
    link_i = idx_after(own_i, {"from", "to"})
    if link_i < 0:
        return None
    kind = words[link_i]
    msg_i = idx_after(link_i, {"message", "messages"})
    if msg_i < 0:
        return None
    end_i = idx_after(msg_i, {"endbridge", "end"})

    def decode(a: int, b: int) -> str:
        out = []
        for w in words[a:b]:
            if w in NATO_TO_CHAR:
                out.append(NATO_TO_CHAR[w])
            elif len(w) == 1 and w.isalnum():
                out.append(w)
        return "".join(out)

    own = decode(own_i + 1, link_i)
    other = decode(link_i + 1, msg_i)
    tail = end_i if end_i >= 0 else len(words)
    body = " ".join(words[msg_i + 1 : tail]).strip()
    if not own or not other or not body:
        return None
    direction = "incoming" if kind == "from" else "outgoing"
    return direction, own, other, body


def tail_file(path: Path, stop_event: threading.Event, log_cb):
    """Yield new lines forever. Handles rotation."""
    last_wait_log = 0.0
    hint = (
        "digite /combatlog no jogo (é o log de COMBATE, diferente de /chatlog)"
        if "Combat" in path.name
        else "digite /chatlog no jogo"
    )
    while not path.exists() and not stop_event.is_set():
        if time.time() - last_wait_log > 60:
            last_wait_log = time.time()
            log_cb(f"⏳ Aguardando {path.name} — {hint}.")
        for _ in range(10):
            if stop_event.is_set():
                return
            time.sleep(1)
    if stop_event.is_set():
        return
    fh = open(path, "r", encoding="utf-8", errors="replace")
    fh.seek(0, os.SEEK_END)
    try:
        inode = os.stat(path).st_ino
    except (AttributeError, OSError):
        inode = None
    size = fh.tell()
    last_read = time.time()
    reopened_logged = 0.0
    while not stop_event.is_set():
        line = fh.readline()
        if line:
            last_read = time.time()
            yield line
            continue
        time.sleep(0.4)
        try:
            st = os.stat(path)
        except FileNotFoundError:
            time.sleep(1)
            continue
        try:
            new_inode = st.st_ino
        except AttributeError:
            new_inode = None
        if (new_inode is not None and new_inode != inode) or st.st_size < size:
            # Log rotation / truncation.
            fh.close()
            fh = open(path, "r", encoding="utf-8", errors="replace")
            inode = new_inode
            size = 0
            last_read = time.time()
        elif st.st_size > size and time.time() - last_read > 2.0:
            # File grew but our handle sees nothing: Windows may be keeping a
            # stale buffered view of the file the game has open. Reopen with a
            # fresh handle positioned at the last known size.
            pos = size
            try:
                fh.close()
            except Exception:
                pass
            fh = open(path, "r", encoding="utf-8", errors="replace")
            try:
                fh.seek(pos)
            except OSError:
                fh.seek(0, os.SEEK_END)
            try:
                inode = os.stat(path).st_ino
            except (AttributeError, OSError):
                inode = None
            if time.time() - reopened_logged > 30:
                reopened_logged = time.time()
                log_cb(
                    f"📄 {path.name} cresceu sem o handle ver — reabrindo "
                    "para ler em tempo real."
                )
        else:
            size = st.st_size
    fh.close()


def log_ts_of(line: str) -> str:
    """Extract the chat-log timestamp of a line ("10/8 12:34:56.789 ..." ->
    "10/8 12:34:56"). Stable across reads, used for deterministic ids."""
    m = TIMESTAMP_RE.match(line)
    if not m:
        return ""
    ts = m.group(0).strip()
    return ts.split(".")[0] if "." in ts else ts


def ext_ts_to_iso(ts: str) -> str:
    """Convert a timestamp key to ISO for receivedAt.
    - digits        -> epoch seconds (from addon <TS:...>)
    - "M/D HH:MM:SS"-> chat log timestamp (assume current year, local time)
    Falls back to now()."""
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if not ts:
        return now_iso
    if re.fullmatch(r"\d{9,11}", ts):
        try:
            dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            if 2000 <= dt.year <= 2100:
                return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            return now_iso
    m = re.match(r"(\d+)/(\d+)(?:/(\d+))?\s+(\d+):(\d+):(\d+)", ts)
    if m:
        try:
            month, day = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else datetime.now().year
            hh, mm, ss = int(m.group(4)), int(m.group(5)), int(m.group(6))
            return datetime(year, month, day, hh, mm, ss).isoformat()
        except ValueError:
            return now_iso
    return now_iso


def make_ext_id(character: str, player: str, body: str, ts: str = "") -> str:
    """
    DETERMINISTIC external id. The same log line always produces the same id,
    so re-reading the log on every "Iniciar" (history sync) hits the unique
    index and NEVER duplicates rows. `ts` must be the line's own timestamp
    (log_ts_of / <TS> tag), not the current time.
    """
    key = (
        f"bw|{character.strip().lower()}|{player.strip().lower()}|"
        f"{body}|{ts}"
    )
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return f"in-{h[:24]}"


# =============================================================================
# Bridge engine (threads)
# =============================================================================
_send_lock = threading.Lock()

DEFAULT_CONTROLS = {
    "bridgeReaderEnabled": True,
    "gseMasterEnabled": False,
    "whisperFocusDelayMs": 2000,
    "whisperAfterSendDelayMs": 1000,
    "whisperChatOpenDelayMs": 1000,
    "whisperKeystrokeDelayMs": 100,
    "whisperChatSendDelayMs": 1000,
    "whisperCloseChatEnabled": True,
    "whisperChatCloseDelayMs": 500,
    "voiceRelayEnabled": True,
    "combatRelayEnabled": True,
    "ocrRelayEnabled": True,
    "wimScreenOcrEnabled": True,
    "queuePollMs": 1500,
}


@dataclass
class RuntimeCharacter:
    character: str
    hwnd: int
    window_title: str
    chat_log: Path


class BridgeEngine:
    def __init__(self, api: ApiClient, log_cb, status_cb):
        self.api = api
        self.log = log_cb
        self.status = status_cb
        self.stop_event = threading.Event()
        self.threads: list[threading.Thread] = []
        self.chars: list[RuntimeCharacter] = []
        # character name -> GseSpammer
        self.spammers: dict[str, GseSpammer] = {}
        self.spammers_lock = threading.Lock()
        self.controls = DEFAULT_CONTROLS.copy()
        self.controls_lock = threading.Lock()
        # Recent whisper triples (character, player, body, timestamp).
        # Used to avoid double-ingesting the same whisper: the addon echo and
        # the native [W From]/[W To] chat log lines describe the same event,
        # and messages the bridge itself typed are already recorded by the site.
        self.recent_whispers: deque = deque(maxlen=400)
        self.recent_whispers_lock = threading.Lock()

    def _recent_dup(self, character: str, player: str, body: str) -> bool:
        """True if this exact whisper was already processed in the last ~15s."""
        now = time.time()
        cutoff = now - 15.0
        with self.recent_whispers_lock:
            while self.recent_whispers and self.recent_whispers[0][3] < cutoff:
                self.recent_whispers.popleft()
            for (c, p, b, _t) in self.recent_whispers:
                if c == character and p == player and b == body:
                    return True
        return False

    def _remember_whisper(self, character: str, player: str, body: str) -> None:
        with self.recent_whispers_lock:
            self.recent_whispers.append((character, player, body, time.time()))

    def _sync_historical_messages(self, ref: RuntimeCharacter) -> None:
        """
        Read the last N lines from the chat log file and ingest them as
        historical messages. This captures whispers that were sent/received
        BEFORE the bridge started (as long as /chatlog was active).
        """
        if not ref.chat_log or not ref.chat_log.exists():
            return
        try:
            # Read last 100 lines to catch recent history
            with open(ref.chat_log, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            
            # Keep only last 100 lines to avoid huge payloads
            lines = lines[-100:] if len(lines) > 100 else lines
            
            buffer = []
            for line in lines:
                parsed = parse_whisper(line, ref.character)
                if parsed:
                    direction, character, other, body = parsed
                    character = character or ref.character
                    line_ts = log_ts_of(line)
                    # Skip if already in recent dedup (from this session)
                    if self._recent_dup(character, other, body):
                        continue
                    self._remember_whisper(character, other, body)
                    buffer.append(
                        {
                            # Deterministic: same as the live tail produced,
                            # so restarting never duplicates.
                            "externalId": make_ext_id(character, other, body, line_ts),
                            "character": character,
                            "player": other,
                            "body": body,
                            "direction": direction,
                            "status": "sent" if direction == "outgoing" else "received",
                            "receivedAt": ext_ts_to_iso(line_ts),
                        }
                    )
            
            if buffer:
                try:
                    self.api.sync(buffer)
                    self.log(f"📜 Histórico sincronizado: {len(buffer)} mensagens de {ref.character}")
                except Exception as e:
                    self.log(f"❌ falha ao sincronizar histórico: {e}")
        except Exception as e:
            self.log(f"❌ erro lendo histórico: {e}")

    def start(self, chars: list[RuntimeCharacter]) -> None:
        self.chars = chars
        self.stop_event.clear()

        # First, sync historical messages from existing log files
        for c in chars:
            if c.chat_log and c.chat_log.exists():
                self._sync_historical_messages(c)

        # Start ONE chatlog tailer PER CHARACTER, even when several WoW windows
        # share the same installation folder / WoWChatLog.txt. Older builds
        # de-duped by file path; with multi-boxing this can make inbound whispers
        # disappear or be attributed only to the first mapped character. Server
        # content-dedupe prevents exact duplicates, while this guarantees
        # WoW -> site visibility.
        for c in chars:
            if not c.chat_log:
                continue
            self.log(f"📖 chatlog ativo para {c.character}: {c.chat_log}")
            t = threading.Thread(target=self._incoming, args=(c,), daemon=True)
            t.start()
            self.threads.append(t)

        t2 = threading.Thread(target=self._outgoing, daemon=True)
        t2.start()
        self.threads.append(t2)

        t3 = threading.Thread(target=self._scanner, daemon=True)
        t3.start()
        self.threads.append(t3)

        # Control syncer — reader on/off, GSE master, delays.
        t4 = threading.Thread(target=self._control_syncer, daemon=True)
        t4.start()
        self.threads.append(t4)

        # GSE state syncer — polls the site and starts/stops spammers.
        t5 = threading.Thread(target=self._gse_syncer, daemon=True)
        t5.start()
        self.threads.append(t5)

        # Voice relay listener — hears the addon speaking whispers and posts
        # them to the site without depending on WoWChatLog.txt at all.
        t6 = threading.Thread(target=self._voice_listener, daemon=True)
        t6.start()
        self.threads.append(t6)

        # Combat-log relay: WoWCombatLog.txt flushes almost instantly, so the
        # addon mirrors every whisper there via a custom emote (BWRELAY...).
        # One tailer per combat log file.
        combat_seen: set[Path] = set()
        for c in chars:
            if not c.chat_log:
                continue
            combat_path = c.chat_log.parent / "WoWCombatLog.txt"
            if combat_path in combat_seen:
                continue
            combat_seen.add(combat_path)
            t7 = threading.Thread(
                target=self._combat_tail, args=(combat_path,), daemon=True
            )
            t7.start()
            self.threads.append(t7)
        if combat_seen:
            self.log(
                "🗡 relay combatlog ativo: lendo WoWCombatLog.txt em tempo real."
            )

        # Screen OCR relay: ONE dedicated worker PER WINDOW. With 20 windows
        # this guarantees messages are never cross-attributed: each worker only
        # screenshots its own hwnd and rejects payloads whose OWN tag does not
        # match its window's character.
        ocr_seen: set[int] = set()
        for c in chars:
            if c.hwnd in ocr_seen:
                continue
            ocr_seen.add(c.hwnd)
            t8 = threading.Thread(target=self._ocr_worker, args=(c,), daemon=True)
            t8.start()
            self.threads.append(t8)
        if ocr_seen:
            self.log(
                f"📷 OCR individual por janela ativo ({len(ocr_seen)} janela(s))."
            )

        # WIM screen reader: OCR of the whole window, no addon/logs needed.
        wim_seen: set[int] = set()
        for c in chars:
            if c.hwnd in wim_seen:
                continue
            wim_seen.add(c.hwnd)
            t9 = threading.Thread(
                target=self._wim_ocr_worker, args=(c,), daemon=True
            )
            t9.start()
            self.threads.append(t9)
        if wim_seen:
            self.log(
                f"🖥 leitor WIM por OCR ativo ({len(wim_seen)} janela(s)) — "
                "funciona SEM addon e SEM arquivos de log."
            )

        self.log(
            f"🥐 {APP_NAME} {APP_VERSION} — loopback + OCR + combatlog + voz. "
            "Se esta linha NÃO apareceu, o .exe é ANTIGO: baixe o artifact do "
            "run mais recente da Action 'Build Windows Executable'."
        )
        self.log(f"✅ Bridge iniciado com {len(chars)} personagem(ns).")

    def stop(self) -> None:
        self.stop_event.set()
        # Kill all spammers
        with self.spammers_lock:
            for s in self.spammers.values():
                s.stop()
            self.spammers.clear()
        self.log("⏹ Bridge parado.")

    def _find_char_by_log(self, log_path: Path) -> Optional[RuntimeCharacter]:
        for c in self.chars:
            if c.chat_log == log_path:
                return c
        return None

    def _find_char_by_name(self, name: str) -> Optional[RuntimeCharacter]:
        wanted = (name or "").strip().lower()
        for c in self.chars:
            if c.character == name or c.character.strip().lower() == wanted:
                return c
        return None

    def _get_controls(self) -> dict:
        with self.controls_lock:
            return self.controls.copy()

    def _control_syncer(self) -> None:
        last_gse_master = None
        last_reader = None
        while not self.stop_event.is_set():
            try:
                raw = self.api.controls()
                merged = DEFAULT_CONTROLS.copy()
                merged.update({k: v for k, v in raw.items() if k in merged})
                with self.controls_lock:
                    self.controls = merged

                if last_reader is None or last_reader != merged["bridgeReaderEnabled"]:
                    self.log(
                        "📖 leitor "
                        + ("ligado" if merged["bridgeReaderEnabled"] else "desligado")
                    )
                    last_reader = merged["bridgeReaderEnabled"]

                if last_gse_master is None or last_gse_master != merged["gseMasterEnabled"]:
                    self.log(
                        "⚙ master GSE "
                        + ("ligado" if merged["gseMasterEnabled"] else "desligado")
                    )
                    last_gse_master = merged["gseMasterEnabled"]

                if not merged["gseMasterEnabled"]:
                    # Idempotent guard: stop spammers on EVERY cycle while the
                    # master is off. Without this, the gse_syncer thread can
                    # race us — it may restart a spammer with stale controls
                    # right after we stopped it, so the key kept being pressed
                    # even with "Master GSE" off on the site.
                    self._stop_all_spammers("master GSE OFF")
            except Exception as e:
                self.log(f"❌ control sync falhou: {e}")

            for _ in range(5):  # 0.5s cadence — reacts faster to master toggles
                if self.stop_event.is_set():
                    return
                time.sleep(0.1)

    def _stop_all_spammers(self, reason: str) -> None:
        with self.spammers_lock:
            for s in self.spammers.values():
                s.pause_event.set()
                s.stop()
            count = len(self.spammers)
            self.spammers.clear()
        if count:
            self.log(f"⏹ {count} GSE parado(s): {reason}")

    def _incoming(self, ref: RuntimeCharacter) -> None:
        buffer: list[dict] = []
        last_flush = time.time()
        lines_seen = 0
        last_whisper_at: Optional[float] = None
        hint_emitted = False
        suspicious_logged = 0
        for line in tail_file(ref.chat_log, self.stop_event, self.log):
            if not self._get_controls().get("bridgeReaderEnabled", True):
                # Reader disabled from the site: keep the tailer alive, but do
                # not parse/ingest messages until re-enabled.
                time.sleep(0.2)
                continue
            lines_seen += 1
            parsed = parse_whisper(line, ref.character)
            if parsed:
                direction, character, other, body = parsed
                character = character or ref.character
                if self._recent_dup(character, other, body):
                    # Same whisper already captured (addon echo + native log
                    # line, or a message the bridge itself typed).
                    continue
                arrow = "→" if direction == "outgoing" else "←"
                self.log(f"{arrow} [{character}] {other}: {body}")
                self._remember_whisper(character, other, body)
                last_whisper_at = time.time()
                hint_emitted = False
                buffer.append(
                    {
                        "externalId": make_ext_id(
                            character, other, body, log_ts_of(line)
                        ),
                        "character": character,
                        "player": other,
                        "body": body,
                        "direction": direction,
                        "status": "sent" if direction == "outgoing" else "received",
                        "receivedAt": ext_ts_to_iso(log_ts_of(line)),
                    }
                )
            elif suspicious_logged < 10:
                raw_lower = line.lower()
                if any(k in raw_lower for k in ["wimbridge", "whisper", "sussurra", "sussurro", "[w ", "[de]", "[para]", "cbsies", "juper"]):
                    suspicious_logged += 1
                    self.log(f"🔎 linha com cara de whisper não parseada: {line.strip()[:240]}")
            if lines_seen > 30 and (last_whisper_at is None or time.time() - last_whisper_at > 180) and not hint_emitted:
                # Watching the log but no whisper line was ever parsed. Surface
                # the two most common setup mistakes instead of failing silently.
                hint_emitted = True
                self.log(
                    "💡 Nenhum whisper detectado no chatlog desta janela ainda. "
                    "Verifique: (1) digite /chatlog no jogo; "
                    "(2) instale o addon WIMBridge (recomendado). "
                    "O fallback nativo ([W From]/[W To]) também funciona só com /chatlog."
                )
            if buffer and (len(buffer) >= 10 or time.time() - last_flush > 1.5):
                try:
                    self.api.ingest(buffer)
                    buffer.clear()
                    last_flush = time.time()
                except Exception as e:
                    self.log(f"❌ ingest falhou: {e}")
                    time.sleep(2)

    def _outgoing(self) -> None:
        while not self.stop_event.is_set():
            try:
                pending = self.api.fetch_queue()
            except Exception as e:
                self.log(f"❌ queue falhou: {e}")
                time.sleep(3)
                continue
            for msg in pending:
                if self.stop_event.is_set():
                    break
                mid = msg["id"]
                character = msg.get("character") or ""
                player = msg["player"]
                body = msg["body"]
                ref = self._find_char_by_name(character)
                if not ref:
                    # Do NOT mark failed. If the buyer/whisper reply is queued
                    # while that WoW window is closed, keep it pending so it can
                    # be sent automatically when the character/window comes back.
                    if not hasattr(self, "_wait_logged"):
                        self._wait_logged = {}
                    if time.time() - self._wait_logged.get(mid, 0) > 30:
                        self._wait_logged[mid] = time.time()
                        self.log(
                            f"⏳ #{mid}: aguardando janela/personagem '{character}' abrir/mapear"
                        )
                    continue
                self.log(f"→ #{mid} [{character} → {player}]: {body}")
                sent = False
                for attempt in range(1, 4):
                    try:
                        self._send(ref, player, body)
                        self.api.ack(mid, "sent")
                        sent = True
                        break
                    except Exception as e:
                        self.log(
                            f"⚠ envio #{mid} tentativa {attempt}/3 falhou: {e}"
                        )
                        if attempt >= 3:
                            break
                        # Self-heal: the window may have been recreated (new
                        # hwnd) or lost focus. Re-resolve by stable title and
                        # retry with growing backoff. Never drop the message.
                        self._heal_ref(ref)
                        time.sleep(1.5 * attempt)
                if not sent:
                    self.log(
                        f"❌ envio #{mid} esgotou 3 tentativas; mantém na fila "
                        "para nova rodada (não marca failed para não perder)."
                    )
                time.sleep(0.3)
            poll_ms = int(self._get_controls().get("queuePollMs", 1500))
            time.sleep(max(0.5, min(10.0, poll_ms / 1000.0)))

    def _send(self, ref: RuntimeCharacter, player: str, body: str) -> None:
        if not (HAS_PYDIRECTINPUT or HAS_PYAUTOGUI):
            raise RuntimeError("pyautogui/pydirectinput não disponíveis")

        # Pause EVERY GSE spammer while we type: simulated keys must never
        # interleave with GSE PostMessages, otherwise characters get eaten
        with self.spammers_lock:
            paused_spammers = list(self.spammers.values())
        for s in paused_spammers:
            s.pause_event.set()

        try:
            with _send_lock:
                # SEQUÊNCIA EXATA conforme especificado pelo usuário:
                # 1. Focar janela + aguardar 2s
                # 2. Enter + aguardar 1s
                # 3. Colar /w nome-server + aguardar 1.5s
                # 4. Colar mensagem + aguardar 1s
                # Foca a janela (com retry e re-resolução de HWND stale).
                self._focus_ref(ref)

                # Passo 1: Focar janela e aguardar 2 segundos
                self.log(f"   ⏳ [1/6] Focando janela (2.0s)...")
                time.sleep(2.0)
                
                # Passo 2: Pressionar Enter e aguardar 1 segundo
                self.log(f"   ⌨️ [2/6] Pressionando Enter...")
                press_key("enter")
                self.log(f"   ⏳ [2/6] Aguardando 1.0s...")
                time.sleep(1.0)
                
                # Passo 3: Colar /w nome-server, aguardar, pressionar ESPAÇO e aguardar
                cmd_prefix = f"/w {player}"
                self.log(f"   📝 [3/6] Colando: {cmd_prefix}")
                if HAS_WIN32:
                    set_clipboard_text(cmd_prefix)
                    time.sleep(0.2)
                    paste_ctrl_v()
                    time.sleep(0.3)  # Tempo para o texto aparecer
                else:
                    # Fallback: digitar devagar
                    for ch in cmd_prefix:
                        press_key(ch)
                        time.sleep(0.05)
                
                self.log(f"   ⏳ [3/6] Aguardando 1.0s...")
                time.sleep(1.0)
                
                # ESPAÇO para o WIM abrir o chat de whisper
                self.log(f"   ⌨️ [4/6] Pressionando ESPAÇO...")
                press_key("space")
                
                self.log(f"   ⏳ [4/6] Aguardando 1.0s (WIM abre)...")
                time.sleep(1.0)
                
                # Passo 5: Colar a mensagem e aguardar 1 segundo
                self.log(f"   📝 [5/6] Colando mensagem: {body[:40]}{'...' if len(body) > 40 else ''}")
                if HAS_WIN32:
                    set_clipboard_text(body)
                    time.sleep(0.2)
                    paste_ctrl_v()
                    time.sleep(0.3)
                else:
                    for ch in body:
                        press_key(ch)
                        time.sleep(0.05)
                self.log(f"   ⏳ [5/6] Aguardando 1.0s...")
                time.sleep(1.0)
                
                # Passo 6: Pressionar Enter e aguardar 1 segundo
                self.log(f"   📤 [6/6] Enviando (Enter)...")
                press_key("enter")
                self.log(f"   ⏳ [6/6] Aguardando 1.0s...")
                time.sleep(1.0)
                
                # Registrar o que foi enviado (para dedup)
                self._remember_whisper(ref.character, player, body)
                
                # Fechar chat com Escape (opcional, mas recomendado)
                close_enabled = bool(self._get_controls().get("whisperCloseChatEnabled", True))
                if close_enabled:
                    press_key("esc")
                    self.log(f"   🔒 Chat fechado")
                
                self.log(f"   ✅ Mensagem enviada com sucesso")
                
        finally:
            for s in paused_spammers:
                s.pause_event.clear()

    def _handle_voice_text(self, text: str) -> None:
        """Parse a transcribed narration line and POST it to the site."""
        parsed = parse_voice_transcript(text)
        if not parsed:
            return
        direction, own_raw, other, body = parsed
        own = self._canonical_char(own_raw) or own_raw
        if not own or not other or not body:
            return
        if self._recent_dup(own, other, body):
            return
        self._remember_whisper(own, other, body)
        bucket = int(time.time() // 10)
        ok = self._ingest_retry(
            [
                {
                    "externalId": f"voice-{bucket}-{make_ext_id(own, other, body)}",
                    "character": own,
                    "player": other,
                    "body": body,
                    "direction": direction,
                    "status": "sent" if direction == "outgoing" else "received",
                    "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            ]
        )
        if ok:
            arrow = "→" if direction == "outgoing" else "←"
            self.log(f"🎙 {arrow} voz [{own}] {other}: {body}")

    def _voice_listener(self) -> None:
        """
        Speech-to-text relay WITHOUT a microphone: captures the audio the PC
        is PLAYING (WASAPI loopback) — i.e. the addon's own TTS narration —
        and transcribes it. Falls back to a real microphone only if loopback
        is unavailable. The addon speaks:
          "Wimbridge. Own <NATO name>. From/To <NATO name>. Message <body>. Endbridge."
        Names are NATO-spelled so transcription is exact. Does NOT depend on
        WoWChatLog.txt at all.
        """
        if not HAS_SPEECH:
            self.log(
                "🎙 modo VOZ indisponível nesta instalação. No BakersWhisper.exe "
                "oficial ele já vem embutido; se roda do código-fonte use "
                "'pip install -r requirements.txt'."
            )
            return

        rec = sr.Recognizer()

        # ---- Preferred: loopback (internal PC audio, no microphone) ----
        if HAS_LOOPBACK:
            spk = None
            try:
                spk = sc.default_speaker()
            except Exception as e:
                self.log(f"🎙 alto-falante padrão falhou ({e}); tentando outros...")
                try:
                    for s in sc.all_speakers():
                        try:
                            spk = s
                            break
                        except Exception:
                            continue
                except Exception:
                    spk = None
            if spk is not None:
              try:
                rate = 16000
                with spk.recorder(samplerate=rate, channels=1) as recorder:
                    self.log(
                        f"🎙 VOZ via LOOPBACK no dispositivo '{getattr(spk, 'name', '?')}': "
                        "transcrevendo a narração interna do PC em tempo real."
                    )
                    first_voice = True
                    while not self.stop_event.is_set():
                        if not self._get_controls().get("voiceRelayEnabled", True):
                            time.sleep(0.5)
                            continue
                        data = recorder.record(num_frames=rate * 3)
                        if data is None:
                            continue
                        peak = float(np.abs(data).max()) if data.size else 0.0
                        if peak < 0.005:
                            continue  # silence — skip STT call
                        pcm = (np.clip(data, -1.0, 1.0) * 32767.0).astype(
                            "<i2"
                        ).tobytes()
                        audio = sr.AudioData(pcm, rate, 2)
                        try:
                            text = rec.recognize_google(audio, language="en-US")
                        except Exception:
                            continue
                        if first_voice and text:
                            first_voice = False
                            self.log(f"🎙 loopback ouviu a primeira narração: '{text[:80]}'")
                        self._handle_voice_text(text)
                    return
              except Exception as e:
                self.log(f"🎙 loopback falhou ({e}); tentando microfone...")

        # ---- Fallback: physical microphone ----
        try:
            mic = sr.Microphone()
        except Exception as e:
            self.log(
                f"🎙 nem loopback nem microfone disponíveis: {e}. "
                "O resto do app funciona normalmente."
            )
            return

        rec.pause_threshold = 0.6

        def _on_audio(recognizer, audio) -> None:
            try:
                if not self._get_controls().get("voiceRelayEnabled", True):
                    return
                text = recognizer.recognize_google(audio, language="en-US")
            except Exception:
                return
            self._handle_voice_text(text)

        try:
            stop_fn = rec.listen_in_background(mic, _on_audio, phrase_time_limit=12)
            self.log(
                "🎙 modo VOZ ativo via MICROFONE (loopback indisponível): "
                "aponte o microfone para o som do WoW."
            )
            while not self.stop_event.is_set():
                time.sleep(0.5)
            try:
                stop_fn(wait_for_stop=False)
            except Exception:
                pass
        except Exception as e:
            self.log(f"🎙 listener de voz falhou: {e}")

    def _heal_ref(self, ref: "RuntimeCharacter") -> bool:
        """
        Self-healing: if a window was recreated (new HWND) or disappeared,
        re-resolve it by the stable renamed title (wow1, wow2...). Returns
        True when the ref is usable again.
        """
        try:
            if ref.hwnd and win32gui.IsWindow(ref.hwnd):
                return True
        except Exception:
            pass
        try:
            for w in enum_wow_windows():
                if ref.window_title and w.title == ref.window_title:
                    ref.hwnd = w.hwnd
                    self.log(
                        f"🔧 janela '{ref.window_title}' re-resolvida "
                        f"(hwnd {w.hwnd})."
                    )
                    return True
        except Exception:
            pass
        return False

    def _ingest_retry(self, payload: list) -> bool:
        """POST /api/ingest with backoff so transient failures never lose data."""
        for attempt in range(1, 4):
            try:
                self.api.ingest(payload)
                return True
            except Exception as e:
                if attempt >= 3:
                    self.log(f"❌ ingest falhou após 3 tentativas: {e}")
                    return False
                time.sleep(1.0 * attempt)
        return False

    def _ocr_worker(self, ref: "RuntimeCharacter") -> None:
        """
        Per-window screen OCR worker. Each WoW window gets its OWN thread that
        only screenshots that window's relay strip, so with 20 windows there is
        never cross-attribution: a payload is accepted ONLY if its OWN tag
        matches this window's character (security against misrouting).
        """
        if not (HAS_MSS and HAS_WINOCR and HAS_WIN32):
            reason = ""
            if not HAS_WINOCR:
                reason = f" winocr/PyWinRT ausente: {WIM_OCR_IMPORT_ERROR}"
            self.log(
                f"📷 OCR principal indisponível para {ref.character}. "
                f"Requer mss + winocr + PyWinRT empacotados no .exe.{reason}"
            )
            return
        import asyncio

        from PIL import Image

        # Tiny stagger so 20 workers don't screenshot in the same instant.
        time.sleep(0.15 * (abs(hash(ref.character)) % 7))
        errs = 0
        first_ok = False
        self.log(f"📷 OCR engine iniciado para {ref.character} (faixa relay).")
        with mss.mss() as sct:
            while not self.stop_event.is_set():
                if not self._get_controls().get("ocrRelayEnabled", True):
                    time.sleep(1)
                    continue
                try:
                    if not self._heal_ref(ref):
                        time.sleep(2)
                        continue
                    l, t, r, b = win32gui.GetWindowRect(ref.hwnd)
                    width = min(1500, max(0, r - l - 12))
                    if width < 120:
                        time.sleep(1)
                        continue
                    region = {
                        "left": l + 6,
                        "top": t + 28,
                        "width": width,
                        "height": 60,
                    }
                    shot = sct.grab(region)
                    pil = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
                    text = winocr_pil_text(pil, "en-US")
                    if not first_ok and text.strip():
                        first_ok = True
                        self.log(
                            f"📷 OCR lendo a janela {ref.character}: "
                            f"{len(text)} chars. Texto: {text.strip()[:180]}"
                        )
                except Exception as e:
                    errs += 1
                    if errs <= 3 or errs % 50 == 0:
                        self.log(f"⚠️ OCR falhou ({errs}x) em {ref.character}: {e}")
                    time.sleep(1)
                    continue
                relay_text = _normalize_relay_ocr(text)
                upper_relay = relay_text.upper()
                has_relay_marker = "WIMRELAY" in upper_relay or "BWRELAY" in upper_relay
                has_relay_tags = "OWN" in upper_relay and ("FROM" in upper_relay or "TO" in upper_relay)
                if not has_relay_marker and not has_relay_tags:
                    time.sleep(1.2)
                    continue
                parsed = parse_whisper(relay_text, ref.character)
                if not parsed:
                    errs += 1
                    if errs <= 5 or errs % 25 == 0:
                        self.log(
                            f"🔎 OCR viu relay mas não parseou em {ref.character}: "
                            f"{relay_text.strip()[:220]}"
                        )
                    time.sleep(1.2)
                    continue
                direction, own_raw, other, body = parsed
                # OCR often confuses letters in OWN (ex: l/I, rn/m). The safe
                # source of truth is the window this worker is screenshotting,
                # not the OCR-read OWN tag. So we route to ref.character and only
                # log mismatches for diagnostics instead of dropping the whisper.
                if (
                    own_raw
                    and ref.character
                    and own_raw.strip().lower() != ref.character.strip().lower()
                ):
                    self.log(
                        f"🔎 OCR OWN diferente em {ref.character}: lido={own_raw!r}; "
                        "roteando pela janela mapeada."
                    )
                own = ref.character or self._canonical_char(own_raw) or own_raw
                if not own or not other or not body:
                    time.sleep(1.2)
                    continue
                if self._recent_dup(own, other, body):
                    time.sleep(1.2)
                    continue
                self._remember_whisper(own, other, body)
                ok = self._ingest_retry(
                    [
                        {
                            "externalId": make_ext_id(
                                own, other, body, f"ocr-{int(time.time() // 8)}"
                            ),
                            "character": own,
                            "player": other,
                            "body": body,
                            "direction": direction,
                            "status": "sent" if direction == "outgoing" else "received",
                            "receivedAt": time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                            ),
                        }
                    ]
                )
                if ok:
                    arrow = "→" if direction == "outgoing" else "←"
                    self.log(f"📷 {arrow} OCR [{own}] {other}: {body}")
                time.sleep(1.2)

    def _wim_ocr_worker(self, ref: "RuntimeCharacter") -> None:
        """
        OUT-OF-GAME reader: OCRs the whole WoW window and extracts the WIM
        conversation lines ("HH:MM [Name]: text"). Works WITHOUT the addon and
        WITHOUT any log file being created — it just reads what is on screen.
        Only INCOMING lines (speaker != this window's character) are ingested,
        so routing is always safe: the window defines the own character and
        the speaker defines the buyer.
        """
        if not (HAS_MSS and HAS_WINOCR and HAS_WIN32):
            self.log(
                f"🖥 leitor WIM indisponível para {ref.character} (mss+winocr)."
            )
            return
        import asyncio

        from PIL import Image

        # Tolerant: OCR may render [Name] as (Name), |Name| or Name.
        line_re = re.compile(
            r"^\s*(\d{1,2}:\d{2})\s*[\[\(\|]?\s*([^:\]\)\|]{1,32}?)\s*[\]\)\|]?\s*[:\-]\s*(\S.{0,200})$"
        )
        own_base = (ref.character.split("-")[0] or "").strip().lower()
        seen: dict = {}
        stats = {"lines": 0, "cand": 0, "own": 0, "sent": 0, "errs": 0}
        last_hb = time.time()
        dbg_path = app_data_dir() / f"ocr_{ref.window_title or ref.character}.txt"
        self.log(f"🖥 OCR WIM engine iniciado para {ref.character}.")
        time.sleep(0.3 * (abs(hash(ref.character)) % 5))
        with mss.mss() as sct:
            while not self.stop_event.is_set():
                if not self._get_controls().get("wimScreenOcrEnabled", True):
                    time.sleep(1)
                    continue
                try:
                    if not self._heal_ref(ref):
                        time.sleep(2)
                        continue
                    l, t, r, b = win32gui.GetWindowRect(ref.hwnd)
                    w = max(0, r - l)
                    h = max(0, b - t)
                    if w < 200 or h < 200:
                        time.sleep(1)
                        continue
                    shot = sct.grab({"left": l, "top": t, "width": w, "height": h})
                    pil = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
                    # Use en-US for whole-window WIM OCR too. The public winocr
                    # package frequently fails on Windows machines without the
                    # Portuguese OCR capability installed, logging:
                    # Add-WindowsCapability -Online -Name "Language.OCR~~~en-US~0.0.1.0"
                    # The relay-strip OCR already works with en-US on these
                    # systems, and WIM OCR only needs player names/text routing.
                    text = winocr_pil_text(pil, "en-US")
                except Exception as e:
                    stats["errs"] += 1
                    if stats["errs"] <= 3 or stats["errs"] % 50 == 0:
                        self.log(
                            f"⚠️ OCR WIM falhou ({stats['errs']}x) em {ref.character}: {e}"
                        )
                    time.sleep(1.5)
                    continue
                now = time.time()
                stats["lines"] += 1
                # DEBUG: dump what the OCR sees so we can diagnose silently
                # failing reads. Open this file to see exactly what the bridge
                # is reading from the WoW window.
                try:
                    dbg_path.write_text(text[:2000], encoding="utf-8")
                except Exception:
                    pass
                seen = {k: v for k, v in seen.items() if now - v < 300}
                for raw in text.splitlines():
                    m = line_re.match(raw.strip())
                    if not m:
                        continue
                    stats["cand"] += 1
                    name = m.group(2).strip()
                    body = m.group(3).strip()
                    low = name.lower()
                    if (
                        not name
                        or not body
                        or low in ("guild", "party", "raid", "system", "wim", "officer")
                    ):
                        continue
                    name_base = name.split("-")[0].strip().lower()
                    if name_base == own_base:
                        stats["own"] += 1
                        continue  # outgoing — o site já sabe; evita rota errada
                    key = ("in", name_base, body.lower())
                    if key in seen:
                        continue
                    seen[key] = now
                    if self._recent_dup(ref.character, name, body):
                        continue
                    self._remember_whisper(ref.character, name, body)
                    bucket = int(now // 300)
                    ok = self._ingest_retry(
                        [
                            {
                                "externalId": make_ext_id(
                                    ref.character, name, body, f"wim-{bucket}"
                                ),
                                "character": ref.character,
                                "player": name,
                                "body": body,
                                "direction": "incoming",
                                "status": "received",
                                "receivedAt": time.strftime(
                                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                                ),
                            }
                        ]
                    )
                    if ok:
                        stats["sent"] += 1
                        self.log(
                            f"🖥 ← WIM-OCR [{ref.character}] {name}: {body}"
                        )
                # Heartbeat every 30s: proves the reader is alive and shows
                # how many whisper-shaped lines it saw (cand) vs own (own).
                if now - last_hb > 30:
                    last_hb = now
                    self.log(
                        f"🖥 OCR [{ref.character}] vivo: {stats['lines']} leituras, "
                        f"{stats['cand']} linhas de whisper, {stats['own']} próprias, "
                        f"{stats['sent']} enviadas ao site, {stats['errs']} erros OCR. "
                        f"Debug: {dbg_path}"
                    )
                time.sleep(2.0)

    def _combat_tail(self, path: Path) -> None:
        """
        Real-time relay via WoWCombatLog.txt. The addon mirrors every whisper
        as a custom emote (SendChatMessage(..., "EMOTE")), and the combat log
        writes EMOTE lines to disk almost instantly — even on clients where
        WoWChatLog.txt only flushes on logout. The emote text carries the same
        BWRELAY/WIMRELAY payload, so parse_whisper understands it.
        """
        unparsed = 0
        for line in tail_file(path, self.stop_event, self.log):
            relay_line = _normalize_relay_ocr(line)
            if "BWRELAY" not in relay_line.upper() and "WIMRELAY" not in relay_line.upper():
                continue
            if not self._get_controls().get("combatRelayEnabled", True):
                continue
            parsed = parse_whisper(relay_line, "")
            if not parsed:
                unparsed += 1
                if unparsed <= 5 or unparsed % 25 == 0:
                    self.log(f"🔎 combatlog relay não parseado: {relay_line.strip()[:220]}")
                continue
            direction, own_raw, other, body = parsed
            own = self._canonical_char(own_raw) or own_raw
            if not own or not other or not body:
                continue
            if self._recent_dup(own, other, body):
                continue
            self._remember_whisper(own, other, body)
            line_ts = log_ts_of(line)
            ok = self._ingest_retry(
                [
                    {
                        "externalId": make_ext_id(own, other, body, line_ts),
                        "character": own,
                        "player": other,
                        "body": body,
                        "direction": direction,
                        "status": "sent" if direction == "outgoing" else "received",
                        "receivedAt": ext_ts_to_iso(line_ts),
                    }
                ]
            )
            if ok:
                arrow = "→" if direction == "outgoing" else "←"
                self.log(f"{arrow} ⚡(combatlog) [{own}] {other}: {body}")

    def _gse_syncer(self) -> None:
        """
        Every second, fetch desired GSE state from the site and reconcile:
          - Start spammer if `running=true` and none exists for the character.
          - Stop spammer if `running=false` and one exists.
          - Update keybind/interval on the existing spammer if changed.
        """
        while not self.stop_event.is_set():
            try:
                states = self.api.gse_states()
            except Exception as e:
                self.log(f"❌ gse sync falhou: {e}")
                time.sleep(3)
                continue

            desired = {s["character"]: s for s in states}
            controls = self._get_controls()
            if not controls.get("gseMasterEnabled", False):
                self._stop_all_spammers("master GSE OFF")
                time.sleep(1.0)
                continue

            with self.spammers_lock:
                # Stop / update existing
                for name, spam in list(self.spammers.items()):
                    d = desired.get(name)
                    if not d or not d.get("running"):
                        spam.stop()
                        self.spammers.pop(name, None)
                    else:
                        spam.update(
                            d.get("keybind", "1"),
                            int(d.get("intervalMs", 100)),
                        )

                # Start new
                for name, d in desired.items():
                    if not d.get("running"):
                        continue
                    if name in self.spammers:
                        continue
                    ref = self._find_char_by_name(name)
                    if not ref:
                        # Character configured on site but not present locally
                        continue
                    spam = GseSpammer(
                        character=name,
                        hwnd=ref.hwnd,
                        keybind=d.get("keybind", "1"),
                        interval_ms=int(d.get("intervalMs", 100)),
                        log_cb=self.log,
                    )
                    spam.start()
                    self.spammers[name] = spam

            for _ in range(10):  # 1s in small steps
                if self.stop_event.is_set():
                    return
                time.sleep(0.1)

    def _scanner(self) -> None:
        while not self.stop_event.is_set():
            try:
                wins = enum_wow_windows()
                payload = []
                for w in wins:
                    matched = self._find_char_by_win(w)
                    char_name = matched.character if matched else ""
                    payload.append(
                        {
                            "hwnd": str(w.hwnd),
                            "pid": str(w.pid),
                            "windowTitle": w.title,
                            "foreground": w.foreground,
                            "character": char_name,
                            "matched": bool(matched),
                            # Extra info so the site can render slot + realm
                            # and warn about server mismatches.
                            "slot": w.slot,
                            "realm": realm_of(char_name),
                        }
                    )
                self.api.scan(payload)
                self.status(len(wins), len([w for w in wins if self._find_char_by_hwnd(w.hwnd)]))
            except Exception as e:
                self.log(f"❌ scan: {e}")
            for _ in range(30):
                if self.stop_event.is_set():
                    return
                time.sleep(0.1)

    def _find_char_by_hwnd(self, hwnd: int) -> Optional[RuntimeCharacter]:
        for c in self.chars:
            if c.hwnd == hwnd:
                return c
        return None

    def _find_char_by_win(self, w: "DetectedWindow") -> Optional[RuntimeCharacter]:
        """
        Match a detected window to a configured character. HWNDs change when
        WoW restarts or a window is recreated, but the renamed title (wow1,
        wow2...) is stable — so we also match by title and keep the stored
        HWND fresh. This fixes "não consegui focar janela 'wow1'" after the
        game has been open for a while / restarted.
        """
        by_hwnd = self._find_char_by_hwnd(w.hwnd)
        if by_hwnd:
            return by_hwnd
        if w.title:
            for c in self.chars:
                if c.window_title and c.window_title == w.title:
                    if c.hwnd != w.hwnd:
                        c.hwnd = w.hwnd
                    return c
        return None

    def _focus_ref(self, ref: "RuntimeCharacter") -> None:
        """Focus the character's window, re-resolving a stale HWND by title."""
        if focus_hwnd(ref.hwnd):
            return
        try:
            for w in enum_wow_windows():
                if (
                    ref.window_title
                    and w.title == ref.window_title
                    and w.hwnd != ref.hwnd
                ):
                    ref.hwnd = w.hwnd
                    if focus_hwnd(ref.hwnd):
                        return
        except Exception:
            pass
        raise RuntimeError(
            f"não consegui focar janela {ref.window_title!r}. "
            "Se o WoW estiver sendo executado como administrador, feche o "
            "BakersWhisper e abra novamente com 'Executar como administrador'."
        )


# =============================================================================
# GUI
# =============================================================================
BG = "#0f172a"
FG = "#e2e8f0"
ACCENT = "#f59e0b"
MUTED = "#64748b"
CARD = "#1e293b"
OK = "#10b981"
BAD = "#ef4444"


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.config = load_config()
        self.api = ApiClient(
            api_url=self.config.server.api_url,
            token=self.config.server.token,
        )
        self.engine: Optional[BridgeEngine] = None
        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.mappings = self.config.mappings
        self.detected: list[DetectedWindow] = []
        self.rows: dict[int, dict] = {}  # hwnd -> {'entry': Entry, 'status_lbl': Label, ...}
        self._last_health_ok: Optional[bool] = None
        self._last_auth_ok: Optional[bool] = None
        self._build_ui()
        self._flush_log_periodically()
        self._auto_scan_periodically()
        self._check_health_periodically()
        self._first_scan()

    # ---------- UI construction ----------
    def _build_ui(self):
        self.root.title(f"{APP_NAME}")
        self.root.geometry("900x680")
        self.root.configure(bg=BG)

        # Header
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=16, pady=(16, 8))
        tk.Label(
            header,
            text=f"🥐 {APP_NAME}",
            bg=BG,
            fg=ACCENT,
            font=("Segoe UI", 18, "bold"),
        ).pack(side="left")
        tk.Label(
            header,
            text=f"v{APP_VERSION}",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 9),
        ).pack(side="left", padx=(8, 0), pady=(6, 0))

        self.status_lbl = tk.Label(
            header,
            text="⏳ conectando ao servidor...",
            bg=BG,
            fg=MUTED,
            font=("Segoe UI", 9),
        )
        self.status_lbl.pack(side="right")

        # Info card
        info = tk.Frame(self.root, bg=CARD)
        info.pack(fill="x", padx=16, pady=(0, 8))
        tk.Label(
            info,
            text=(
                "1) Abra o WoW em cada janela\n"
                "2) Digite /chatlog dentro do jogo (uma vez por janela)\n"
                "3) Digite o nome do personagem ao lado da janela detectada\n"
                "4) Clique em ▶ Iniciar"
            ),
            bg=CARD,
            fg=FG,
            justify="left",
            font=("Segoe UI", 9),
            padx=12,
            pady=8,
        ).pack(anchor="w")

        # Server settings card
        server_box = tk.Frame(self.root, bg=CARD)
        server_box.pack(fill="x", padx=16, pady=(0, 8))
        tk.Label(
            server_box,
            text="Servidor",
            bg=CARD,
            fg=ACCENT,
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=4,
        ).grid(row=0, column=0, sticky="w")

        tk.Label(
            server_box,
            text="API URL",
            bg=CARD,
            fg=MUTED,
            font=("Segoe UI", 8),
            padx=12,
        ).grid(row=1, column=0, sticky="w")
        self.api_url_entry = tk.Entry(
            server_box,
            bg="#0f172a",
            fg=FG,
            insertbackground=FG,
            relief="flat",
            font=("Consolas", 9),
            width=48,
        )
        self.api_url_entry.insert(0, self.config.server.api_url)
        self.api_url_entry.grid(row=1, column=1, sticky="we", padx=(0, 8), pady=2)

        tk.Label(
            server_box,
            text="Token",
            bg=CARD,
            fg=MUTED,
            font=("Segoe UI", 8),
            padx=12,
        ).grid(row=2, column=0, sticky="w")
        self.token_entry = tk.Entry(
            server_box,
            bg="#0f172a",
            fg=FG,
            insertbackground=FG,
            relief="flat",
            font=("Consolas", 9),
            show="•",
            width=48,
        )
        token_value = "" if self.config.server.token == "REPLACE_WITH_YOUR_TOKEN" else self.config.server.token
        self.token_entry.insert(0, token_value)
        self.token_entry.grid(row=2, column=1, sticky="we", padx=(0, 8), pady=4)

        server_box.grid_columnconfigure(1, weight=1)
        tk.Button(
            server_box,
            text="💾 Salvar servidor",
            bg="#334155",
            fg=FG,
            font=("Segoe UI", 8),
            relief="flat",
            padx=10,
            pady=4,
            command=self.on_save_server,
        ).grid(row=1, column=2, rowspan=1, sticky="e", padx=(0, 12))
        tk.Button(
            server_box,
            text="🌐 Testar",
            bg="#334155",
            fg=FG,
            font=("Segoe UI", 8),
            relief="flat",
            padx=10,
            pady=4,
            command=self.on_test_connection,
        ).grid(row=2, column=2, rowspan=1, sticky="e", padx=(0, 12))

        # Table container with scroll
        wrap = tk.Frame(self.root, bg=BG)
        wrap.pack(fill="both", expand=False, padx=16, pady=(8, 8))
        tk.Label(
            wrap,
            text="Janelas do WoW detectadas",
            bg=BG,
            fg=FG,
            font=("Segoe UI", 10, "bold"),
        ).pack(anchor="w", pady=(0, 4))

        canvas_frame = tk.Frame(wrap, bg=CARD, height=200)
        canvas_frame.pack(fill="x")
        self.table_canvas = tk.Canvas(canvas_frame, bg=CARD, highlightthickness=0, height=220)
        scroll = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.table_canvas.yview)
        self.table_canvas.configure(yscrollcommand=scroll.set)
        self.table_canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.table_inner = tk.Frame(self.table_canvas, bg=CARD)
        self.table_canvas.create_window((0, 0), window=self.table_inner, anchor="nw")
        self.table_inner.bind(
            "<Configure>",
            lambda e: self.table_canvas.configure(scrollregion=self.table_canvas.bbox("all")),
        )

        # Controls
        controls = tk.Frame(self.root, bg=BG)
        controls.pack(fill="x", padx=16, pady=8)
        self.start_btn = tk.Button(
            controls,
            text="▶ Iniciar",
            bg=OK,
            fg="white",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=16,
            pady=6,
            command=self.on_start,
        )
        self.start_btn.pack(side="left")

        self.stop_btn = tk.Button(
            controls,
            text="⏹ Parar",
            bg=BAD,
            fg="white",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=16,
            pady=6,
            command=self.on_stop,
            state="disabled",
        )
        self.stop_btn.pack(side="left", padx=(8, 0))

        tk.Button(
            controls,
            text="🔄 Rescan",
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=6,
            command=self._first_scan,
        ).pack(side="left", padx=(8, 0))

        tk.Button(
            controls,
            text="🔤 Renomear janelas",
            bg=CARD,
            fg=ACCENT,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=6,
            command=self.on_rename_now,
        ).pack(side="left", padx=(8, 0))

        tk.Button(
            controls,
            text="💾 Salvar personagens",
            bg=CARD,
            fg=OK,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=6,
            command=self.on_save_characters,
        ).pack(side="left", padx=(8, 0))

        tk.Button(
            controls,
            text="🌐 Testar conexão",
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=6,
            command=self.on_test_connection,
        ).pack(side="left", padx=(8, 0))

        self.auto_rename_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            controls,
            text="Renomear ao iniciar",
            variable=self.auto_rename_var,
            bg=BG,
            fg=FG,
            selectcolor=CARD,
            activebackground=BG,
            activeforeground=FG,
            font=("Segoe UI", 9),
            highlightthickness=0,
            bd=0,
        ).pack(side="left", padx=(8, 0))

        tk.Button(
            controls,
            text="🌐 Abrir Painel",
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 9),
            relief="flat",
            padx=12,
            pady=6,
            command=lambda: self._open_url(API_URL),
        ).pack(side="right")

        # Log window
        tk.Label(
            self.root,
            text="Log",
            bg=BG,
            fg=FG,
            font=("Segoe UI", 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(8, 4))

        self.log_widget = scrolledtext.ScrolledText(
            self.root,
            height=14,
            bg="#020617",
            fg=FG,
            font=("Consolas", 9),
            insertbackground=FG,
            relief="flat",
        )
        self.log_widget.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self.log_widget.configure(state="disabled")

        self._log(f"{APP_NAME} v{APP_VERSION}")
        self._log(f"Servidor: {API_URL}")
        self._log(f"Config: {CONFIG_FILE}")
        if not HAS_WIN32:
            self._log("⚠ pywin32 não disponível — a detecção de janelas não vai funcionar.")
        if not HAS_PSUTIL:
            self._log("⚠ psutil não disponível — não vou conseguir achar o log do WoW automaticamente.")

    # ---------- Actions ----------
    def _first_scan(self):
        self.detected = enum_wow_windows()
        # Assign a wowN slot to each detected window (persisted by exe_path).
        slots = assign_slots(self.detected, self.mappings)
        for w in self.detected:
            w.slot = slots.get(w.hwnd, 0)
        self._render_table()
        self._log(f"🔍 {len(self.detected)} janela(s) do WoW detectada(s).")

    def on_rename_now(self):
        if not self.detected:
            self._log("⚠ Nada para renomear (nenhuma janela detectada).")
            return
        slots = {w.hwnd: w.slot for w in self.detected if w.slot}
        ok = apply_renames(self.detected, slots)
        self._log(f"🔤 {ok} janela(s) renomeada(s) para wow1, wow2, ...")
        self._render_table()

    def _save_character_entries(self) -> int:
        count = 0
        for hwnd, row in self.rows.items():
            w: DetectedWindow = row["win"]
            name = row["entry"].get().strip()
            if not w.slot:
                continue
            key = f"slot:{w.slot}"
            if name:
                self.mappings[key] = SavedMapping(
                    exe_path=w.exe_path,
                    slot=w.slot,
                    character=name,
                )
                count += 1
            elif key in self.mappings:
                # Empty field intentionally clears that slot's saved name.
                self.mappings.pop(key, None)
        self.config.mappings = self.mappings
        save_config(self.config)
        return count

    def on_save_characters(self):
        try:
            count = self._save_character_entries()
            self._log(f"💾 {count} personagem(ns) salvo(s) por slot wowN.")
        except Exception as e:
            self._log(f"❌ erro ao salvar personagens: {e}")

    def on_save_server(self):
        api_url = self.api_url_entry.get().strip().rstrip("/")
        token = self.token_entry.get().strip()
        if not api_url.startswith("http://") and not api_url.startswith("https://"):
            messagebox.showwarning(
                APP_NAME,
                "API URL inválida. Ela precisa começar com http:// ou https://\n\n"
                "Exemplo: https://wimmsg-lntm.vercel.app",
            )
            return
        self.config.server = ServerSettings(api_url=api_url, token=token)
        self.api.update_server(api_url, token)
        try:
            save_config(self.config)
            self._log(f"💾 servidor salvo: {api_url}")
        except Exception as e:
            self._log(f"❌ não consegui salvar servidor: {e}")
            return
        self.on_test_connection()

    def on_test_connection(self):
        # Apply unsaved values temporarily too, so the user can test before saving.
        api_url = self.api_url_entry.get().strip().rstrip("/")
        token = self.token_entry.get().strip()
        if api_url:
            self.api.update_server(api_url, token)

        def check():
            self._log(f"🌐 testando {self.api.api_url}/api/health ...")
            ok, msg = self.api.health()
            self._log(("✅" if ok else "❌") + f" health: {msg}")
            if ok:
                auth_ok, auth_msg = self.api.auth_check()
                self._log(("✅" if auth_ok else "❌") + f" auth: {auth_msg}")
        threading.Thread(target=check, daemon=True).start()

    def _render_table(self):
        for w in self.table_inner.winfo_children():
            w.destroy()
        self.rows.clear()

        if not self.detected:
            tk.Label(
                self.table_inner,
                text="Nenhuma janela do WoW aberta. Abra o WoW e clique em 🔄 Rescan.",
                bg=CARD,
                fg=MUTED,
                padx=12,
                pady=20,
                font=("Segoe UI", 9),
            ).pack()
            return

        # Header row
        hdr = tk.Frame(self.table_inner, bg=CARD)
        hdr.pack(fill="x", pady=(6, 2), padx=8)
        for text, w in (
            ("Slot", 8),
            ("Título", 24),
            ("Personagem-Reino", 24),
            ("Log", 12),
            ("", 10),
        ):
            tk.Label(
                hdr,
                text=text,
                bg=CARD,
                fg=MUTED,
                font=("Segoe UI", 8, "bold"),
                width=w,
                anchor="w",
            ).pack(side="left")

        for win in self.detected:
            self._render_row(win)

    def _render_row(self, win: DetectedWindow):
        row = tk.Frame(self.table_inner, bg=CARD)
        row.pack(fill="x", padx=8, pady=2)

        # Slot label (wowN)
        slot_txt = f"wow{win.slot}" if win.slot else "?"
        tk.Label(
            row,
            text=slot_txt,
            bg=CARD,
            fg=ACCENT,
            font=("Consolas", 10, "bold"),
            width=8,
            anchor="w",
        ).pack(side="left")

        # Current window title (may already be wowN if renamed)
        tk.Label(
            row,
            text=(win.title[:22] + "…") if len(win.title) > 24 else win.title,
            bg=CARD,
            fg=FG,
            font=("Segoe UI", 9),
            width=24,
            anchor="w",
        ).pack(side="left")

        # Character entry — pre-fill from persisted map keyed by slot.
        # This lets each wowN keep a different own-character name even when all
        # windows come from the same WoW installation folder.
        entry = tk.Entry(
            row,
            bg="#0f172a",
            fg=FG,
            insertbackground=FG,
            relief="flat",
            font=("Consolas", 9),
            width=24,
        )
        saved = self.mappings.get(f"slot:{win.slot}") if win.slot else None
        if saved and saved.character:
            entry.insert(0, saved.character)
        entry.pack(side="left", padx=(4, 4))

        # Log status
        log_ok = win.chat_log and Path(win.chat_log).exists()
        log_lbl = tk.Label(
            row,
            text="✅ log ok" if log_ok else "❌ /chatlog",
            bg=CARD,
            fg=OK if log_ok else BAD,
            font=("Segoe UI", 9),
            width=12,
            anchor="w",
        )
        log_lbl.pack(side="left")

        # Foreground badge
        fg_txt = "🎯 em foco" if win.foreground else ""
        tk.Label(
            row,
            text=fg_txt,
            bg=CARD,
            fg=ACCENT,
            font=("Segoe UI", 8),
            width=10,
            anchor="w",
        ).pack(side="left")

        self.rows[win.hwnd] = {"entry": entry, "log_lbl": log_lbl, "win": win}

    def on_start(self):
        # Optionally rename every detected window to wow1, wow2, ...
        if self.auto_rename_var.get() and self.detected:
            slots = {w.hwnd: w.slot for w in self.detected if w.slot}
            renamed = apply_renames(self.detected, slots)
            if renamed:
                self._log(f"🔤 {renamed} janela(s) renomeada(s) automaticamente.")

        chars: list[RuntimeCharacter] = []
        for hwnd, row in self.rows.items():
            name = row["entry"].get().strip()
            if not name:
                continue
            w: DetectedWindow = row["win"]
            log_path = Path(w.chat_log) if w.chat_log else Path()
            chars.append(
                RuntimeCharacter(
                    character=name,
                    hwnd=hwnd,
                    window_title=w.title,
                    chat_log=log_path,
                )
            )
            # Persist later by slot via _save_character_entries().

        if not chars:
            messagebox.showwarning(
                APP_NAME,
                "Nenhum personagem configurado.\n\nDigite o nome do personagem "
                "ao lado de cada janela detectada (ex. Aragorn-Nemesis) e "
                "clique em ▶ Iniciar de novo.",
            )
            return

        # Warn if any character is missing the -Reino suffix — we can't
        # validate server matches without it.
        no_realm = [c.character for c in chars if "-" not in c.character]
        if no_realm:
            answer = messagebox.askyesno(
                APP_NAME,
                "Estes personagens estão sem o servidor no nome:\n\n"
                + "\n".join(f"  • {n}" for n in no_realm)
                + "\n\nSem o -Reino, o site não consegue avisar se você está "
                "tentando responder alguém de outro servidor.\n\n"
                "Continuar mesmo assim?",
            )
            if not answer:
                return

        try:
            self._save_character_entries()
        except Exception as e:
            self._log(f"⚠ não consegui salvar config: {e}")

        self.engine = BridgeEngine(self.api, self._log, self._update_status_counters)
        self.engine.start(chars)
        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")

    def on_stop(self):
        if self.engine:
            self.engine.stop()
            self.engine = None
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")

    # ---------- Logging & periodic tasks ----------
    def _log(self, msg: str):
        stamp = time.strftime("%H:%M:%S")
        self.log_queue.put(f"[{stamp}] {msg}")

    def _flush_log_periodically(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.log_widget.configure(state="normal")
                self.log_widget.insert("end", msg + "\n")
                self.log_widget.see("end")
                self.log_widget.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(200, self._flush_log_periodically)

    def _auto_scan_periodically(self):
        # Only auto-rescans the table when bridge is NOT running (avoids
        # UI churn during normal operation).
        if self.engine is None:
            new = enum_wow_windows()
            if len(new) != len(self.detected) or {w.hwnd for w in new} != {
                w.hwnd for w in self.detected
            }:
                slots = assign_slots(new, self.mappings)
                for w in new:
                    w.slot = slots.get(w.hwnd, 0)
                self.detected = new
                self._render_table()
        self.root.after(5000, self._auto_scan_periodically)

    def _check_health_periodically(self):
        def check():
            ok, msg = self.api.health()
            auth_ok, auth_msg = self.api.auth_check() if ok else (False, "")
            self.root.after(0, lambda: self._update_status(ok, msg, auth_ok, auth_msg))
        threading.Thread(target=check, daemon=True).start()
        self.root.after(10000, self._check_health_periodically)

    def _update_status(self, ok: bool, msg: str, auth_ok: bool, auth_msg: str):
        if ok and auth_ok:
            self.status_lbl.configure(text="🟢 servidor online", fg=OK)
        elif ok and not auth_ok:
            self.status_lbl.configure(text="🟠 servidor online, token inválido", fg=ACCENT)
        else:
            self.status_lbl.configure(text="🔴 sem conexão com servidor", fg=BAD)

        # Log only on state changes (avoid flooding every 10s).
        if self._last_health_ok is None or self._last_health_ok != ok:
            self._log(("✅" if ok else "❌") + f" health: {msg}")
            self._last_health_ok = ok
        if ok and (self._last_auth_ok is None or self._last_auth_ok != auth_ok):
            self._log(("✅" if auth_ok else "❌") + f" auth: {auth_msg}")
            self._last_auth_ok = auth_ok

    def _update_status_counters(self, total: int, matched: int):
        gse_count = 0
        if self.engine:
            with self.engine.spammers_lock:
                gse_count = len(self.engine.spammers)
        extra = f" · ⚙ {gse_count} GSE" if gse_count else ""
        self.root.after(
            0,
            lambda: self.status_lbl.configure(
                text=f"🟢 {matched}/{total} janela(s) mapeada(s){extra}",
                fg=OK,
            ),
        )

    def _open_url(self, url: str):
        import webbrowser
        webbrowser.open(url)


# =============================================================================
# Entry point
# =============================================================================
def main():
    if BRIDGE_TOKEN == "REPLACE_WITH_YOUR_TOKEN":
        # Still runs — but user is warned that the build is unconfigured.
        pass
    root = tk.Tk()
    try:
        root.iconbitmap(default="")
    except Exception:
        pass
    app = App(root)
    root.protocol("WM_DELETE_WINDOW", lambda: (app.on_stop(), root.destroy()))
    root.mainloop()


if __name__ == "__main__":
    main()

er.open(url)


# =============================================================================
# Entry point
# =============================================================================
def main():
    if BRIDGE_TOKEN == "REPLACE_WITH_YOUR_TOKEN":
        # Still runs — but user is warned that the build is unconfigured.
        pass
    root = tk.Tk()
    try:
        root.iconbitmap(default="")
    except Exception:
        pass
    app = App(root)
    root.protocol("WM_DELETE_WINDOW", lambda: (app.on_stop(), root.destroy()))
    root.mainloop()


if __name__ == "__main__":
    main()

