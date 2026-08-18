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
APP_VERSION = "1.0.7"
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
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from tkinter import messagebox, scrolledtext, ttk
from typing import Optional

import requests

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

try:
    import win32file  # type: ignore
    import win32con  # type: ignore  # noqa: F811 (rebind ok)
    HAS_WIN32FILE = True
except Exception:
    HAS_WIN32FILE = False


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
    if not HAS_WIN32:
        return False
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        return True
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
    r"WIMRELAY<OWN:(?P<own>[^>]+)><FROM:(?P<from>[^>]+)>(?:<TS:(?P<ts>[^>]+)>)?(?P<body>.*)$"
)
RELAY_TO_RE = re.compile(
    r"WIMRELAY<OWN:(?P<own>[^>]+)><TO:(?P<to>[^>]+)>(?:<TS:(?P<ts>[^>]+)>)?(?P<body>.*)$"
)
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
FALLBACKS_IN = [
    re.compile(r"^(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?)\s+whispers?:\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(r"^(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?)\s+sussurra:\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(r"^De\s+(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?):\s+(?P<body>.+)$", re.IGNORECASE),
]
FALLBACKS_OUT = [
    re.compile(r"^(?:To|Para)\s+(?P<to>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?):\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(r"^Você\s+sussurra\s+para\s+(?P<to>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?):\s+(?P<body>.+)$", re.IGNORECASE),
    re.compile(r"^You\s+whisper\s+to\s+(?P<to>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?):\s+(?P<body>.+)$", re.IGNORECASE),
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

    addon_clean = _strip_wow_markup(stripped)
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


def _read_shared(path: Path, offset: int) -> tuple[str, int, int]:
    """Read `path` from `offset` using Win32 CreateFile with FULL sharing.

    This is the KEY fix for "messages only appear after closing WoW": while
    the game is running it keeps WoWChatLog.txt locked for writing, and a
    normal Python open() either fails or sees stale content on Windows.
    FILE_SHARE_READ|WRITE|DELETE lets us read the live file anyway.

    Returns (text, new_offset, file_size). If the file rotated/shrunk, the
    offset is reset to 0.
    """
    handle = win32file.CreateFile(
        str(path),
        win32con.GENERIC_READ,
        win32con.FILE_SHARE_READ
        | win32con.FILE_SHARE_WRITE
        | win32con.FILE_SHARE_DELETE,
        None,
        win32con.OPEN_EXISTING,
        win32con.FILE_ATTRIBUTE_NORMAL,
        None,
    )
    try:
        size = win32file.GetFileSize(handle)
        if offset > size:
            offset = 0
        if offset > 0:
            win32file.SetFilePointer(handle, offset, win32con.FILE_BEGIN)
        chunks: list[bytes] = []
        remaining = size - offset
        while remaining > 0:
            to_read = min(remaining, 65536)
            _hr, data = win32file.ReadFile(handle, to_read)
            if not data:
                break
            chunks.append(data)
            remaining -= len(data)
        new_offset = offset + sum(len(c) for c in chunks)
        text = b"".join(chunks).decode("utf-8", errors="replace")
        return text, new_offset, size
    finally:
        handle.Close()


def tail_file_shared(
    path: Path,
    stop_event: threading.Event,
    log_cb,
    start_offset: Optional[int] = None,
):
    """Yield new lines forever using shared Win32 access. Handles rotation."""
    while not path.exists() and not stop_event.is_set():
        log_cb(f"⏳ Aguardando {path.name} — digite /chatlog no jogo.")
        for _ in range(10):
            if stop_event.is_set():
                return
            time.sleep(1)
    if stop_event.is_set():
        return
    try:
        offset = path.stat().st_size
    except OSError:
        offset = 0
    if start_offset is not None and start_offset > 0:
        offset = start_offset
    pending = ""
    while not stop_event.is_set():
        try:
            text, offset, _size = _read_shared(path, offset)
        except Exception:
            time.sleep(1)
            continue
        if text:
            pending += text
            parts = pending.split("\n")
            pending = parts[-1]
            for line in parts[:-1]:
                yield line
        else:
            time.sleep(0.4)


def tail_file(path: Path, stop_event: threading.Event, log_cb, start_offset=None):
    """Yield new lines forever. Handles rotation.

    On Windows we use the shared-access reader so the bridge can see new
    lines IN REAL TIME even while WoW keeps the log file open (otherwise
    everything only shows up after the game window is closed).
    """
    if HAS_WIN32FILE and sys.platform == "win32":
        yield from tail_file_shared(path, stop_event, log_cb, start_offset)
        return

    while not path.exists() and not stop_event.is_set():
        log_cb(f"⏳ Aguardando {path.name} — digite /chatlog no jogo.")
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
    while not stop_event.is_set():
        line = fh.readline()
        if line:
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
            fh.close()
            fh = open(path, "r", encoding="utf-8", errors="replace")
            inode = new_inode
            size = 0
        else:
            size = st.st_size
    fh.close()


def make_ext_id(character: str, player: str, body: str) -> str:
    h = hashlib.sha1(
        f"{time.time():.3f}|{character}|{player}|{body}".encode("utf-8")
    ).hexdigest()
    return f"in-{h[:16]}"


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
                    # Skip if already in recent dedup (from this session)
                    if self._recent_dup(character, other, body):
                        continue
                    self._remember_whisper(character, other, body)
                    buffer.append(
                        {
                            "externalId": make_ext_id(character, other, body),
                            "character": character,
                            "player": other,
                            "body": body,
                            "direction": direction,
                            "status": "sent" if direction == "outgoing" else "received",
                            "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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

        # De-dup chat logs — one tailer per file.
        seen: set[Path] = set()
        for c in chars:
            if not c.chat_log:
                continue
            if c.chat_log in seen:
                continue
            seen.add(c.chat_log)
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
                        "externalId": make_ext_id(character, other, body),
                        "character": character,
                        "player": other,
                        "body": body,
                        "direction": direction,
                        "status": "sent" if direction == "outgoing" else "received",
                        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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
                    self.log(
                        f"⏳ #{mid}: aguardando janela/personagem '{character}' abrir/mapeiar"
                    )
                    continue
                self.log(f"→ #{mid} [{character} → {player}]: {body}")
                try:
                    self._send(ref, player, body)
                    self.api.ack(mid, "sent")
                except Exception as e:
                    self.log(f"❌ envio #{mid}: {e}")
                    try:
                        self.api.ack(mid, "failed", error=str(e))
                    except Exception:
                        pass
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
                # 5. Enter + aguardar 1s
                
                if not focus_hwnd(ref.hwnd):
                    raise RuntimeError(f"não consegui focar janela {ref.window_title!r}")
                
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
                    matched = self._find_char_by_hwnd(w.hwnd)
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
