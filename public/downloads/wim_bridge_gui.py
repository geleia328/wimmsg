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

# =============================================================================
# CONSTANTES DE BUILD — editadas antes de compilar o executável
# =============================================================================
API_URL = "https://wimmsg-lntm.vercel.app"
BRIDGE_TOKEN = "REPLACE_WITH_YOUR_TOKEN"
APP_NAME = "Bakers Whisper"
APP_VERSION = "1.0.0"
# =============================================================================

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk
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
# Persistent config (character name mappings)
# =============================================================================
@dataclass
class SavedMapping:
    """
    Persisted per WoW install (keyed by exe_path). We remember:
      - `slot`: the wowN number this install had last time
      - `character`: the character name typed by the user for that install

    Keying by exe_path (not window title / hwnd / pid) means the same install
    always gets the same slot/character across restarts.
    """
    exe_path: str
    slot: int
    character: str


def load_mappings() -> dict[str, SavedMapping]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        out: dict[str, SavedMapping] = {}
        for key, item in data.get("mappings", {}).items():
            # Backwards compat: old format used window_title as key.
            if "exe_path" in item:
                out[key] = SavedMapping(**item)
        return out
    except Exception:
        return {}


def save_mappings(mappings: dict[str, SavedMapping]) -> None:
    payload = {"mappings": {k: m.__dict__ for k, m in mappings.items()}}
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
    def __init__(self) -> None:
        self.s = requests.Session()
        if BRIDGE_TOKEN and BRIDGE_TOKEN != "REPLACE_WITH_YOUR_TOKEN":
            self.s.headers["Authorization"] = f"Bearer {BRIDGE_TOKEN}"
        self.s.headers["content-type"] = "application/json"
        self.s.headers["user-agent"] = f"{APP_NAME}/{APP_VERSION}"

    def _url(self, p: str) -> str:
        return f"{API_URL.rstrip('/')}{p}"

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

    def health(self) -> bool:
        try:
            r = self.s.get(self._url("/api/health"), timeout=5)
            return r.ok
        except Exception:
            return False


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
        looks_wow_by_title = any(h in low for h in WOW_TITLE_HINTS)
        pid = _pid_for_hwnd(hwnd)
        exe = _exe_for_pid(pid) if pid else ""
        exe_low = exe.lower()
        looks_wow_by_exe = any(h in exe_low for h in WOW_EXE_HINTS)
        if not (looks_wow_by_title or looks_wow_by_exe):
            return
        # Filter out browser tabs with "WoW" in the title, editors, etc.
        if not looks_wow_by_exe and any(
            bad in low for bad in ("chrome", "firefox", "edge", "code -", "visual studio")
        ):
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
      1) If the exe_path was seen before → reuse the same slot.
      2) Otherwise pick the smallest slot not already used.

    Returns: {hwnd: slot_number}
    """
    used: set[int] = set()
    result: dict[int, int] = {}

    # Pass 1 — restore known installs
    for w in wins:
        m = saved.get(w.exe_path) if w.exe_path else None
        if m and m.slot not in used:
            result[w.hwnd] = m.slot
            used.add(m.slot)

    # Pass 2 — assign fresh slots to new/unrecognized installs
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
TIMESTAMP_RE = re.compile(r"^\d+/\d+\s+\d+:\d+:\d+\.\d+\s+")
ADDON_RE = re.compile(
    r"^\[WIMBRIDGE\]<OWN:(?P<own>[^>]+)><FROM:(?P<from>[^>]+)>(?P<body>.*)$"
)
FALLBACKS = [
    re.compile(r"^(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?)\s+whispers?:\s+(?P<body>.+)$"),
    re.compile(r"^(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?)\s+sussurra:\s+(?P<body>.+)$"),
]


def parse_whisper(line: str, own_default: str) -> Optional[tuple[str, str, str]]:
    raw = line.rstrip("\r\n")
    stripped = TIMESTAMP_RE.sub("", raw).strip()
    m = ADDON_RE.match(stripped)
    if m:
        return m.group("own").strip(), m.group("from").strip(), m.group("body").strip()
    clean = re.sub(r"\|c[0-9a-fA-F]{8}", "", stripped)
    clean = re.sub(r"\|H[^|]*\|h", "", clean)
    clean = clean.replace("|h", "").replace("|r", "").replace("[", "").replace("]", "")
    for pat in FALLBACKS:
        m = pat.match(clean)
        if m:
            return own_default, m.group("from").strip(), m.group("body").strip()
    return None


def tail_file(path: Path, stop_event: threading.Event, log_cb):
    """Yield new lines forever. Handles rotation."""
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

    def start(self, chars: list[RuntimeCharacter]) -> None:
        self.chars = chars
        self.stop_event.clear()

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

        # GSE state syncer — polls the site and starts/stops spammers.
        t4 = threading.Thread(target=self._gse_syncer, daemon=True)
        t4.start()
        self.threads.append(t4)

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
        for c in self.chars:
            if c.character == name:
                return c
        return None

    def _incoming(self, ref: RuntimeCharacter) -> None:
        buffer: list[dict] = []
        last_flush = time.time()
        for line in tail_file(ref.chat_log, self.stop_event, self.log):
            parsed = parse_whisper(line, ref.character)
            if parsed:
                own, sender, body = parsed
                character = own or ref.character
                self.log(f"← [{character}] {sender}: {body}")
                buffer.append(
                    {
                        "externalId": make_ext_id(character, sender, body),
                        "character": character,
                        "player": sender,
                        "body": body,
                        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
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
                    err = f"personagem '{character}' não configurado aqui"
                    self.log(f"❌ #{mid}: {err}")
                    try:
                        self.api.ack(mid, "failed", error=err)
                    except Exception:
                        pass
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
            time.sleep(1.0)

    def _send(self, ref: RuntimeCharacter, player: str, body: str) -> None:
        if not (HAS_PYDIRECTINPUT or HAS_PYAUTOGUI):
            raise RuntimeError("pyautogui/pydirectinput não disponíveis")

        # Pause this character's GSE spammer during the type sequence so the
        # simulated keys don't collide with GSE's rotation. Other characters
        # keep spamming — their spammers write to their own windows via
        # PostMessage in background.
        spammer = None
        with self.spammers_lock:
            spammer = self.spammers.get(ref.character)
        if spammer:
            spammer.pause_event.set()

        try:
            with _send_lock:
                if not focus_hwnd(ref.hwnd):
                    raise RuntimeError(f"não consegui focar janela {ref.window_title!r}")
                # Small delay lets any in-flight PostMessage flush before we
                # start typing on the (now focused) window.
                time.sleep(0.30)
                if HAS_PYDIRECTINPUT:
                    pydirectinput.press("enter")
                else:
                    pyautogui.press("enter")
                time.sleep(0.08)
                cmd = f"/w {player} {body}"
                if HAS_PYAUTOGUI:
                    pyautogui.typewrite(cmd, interval=0.02)
                else:
                    for ch in cmd:
                        pydirectinput.write(ch, interval=0.02)
                time.sleep(0.05)
                if HAS_PYDIRECTINPUT:
                    pydirectinput.press("enter")
                else:
                    pyautogui.press("enter")
                # Small pause before releasing so the /w command is processed
                # before GSE resumes hammering keys at the window.
                time.sleep(0.15)
        finally:
            if spammer:
                spammer.pause_event.clear()

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
        self.api = ApiClient()
        self.engine: Optional[BridgeEngine] = None
        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.mappings = load_mappings()
        self.detected: list[DetectedWindow] = []
        self.rows: dict[int, dict] = {}  # hwnd -> {'entry': Entry, 'status_lbl': Label, ...}
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

        # Character entry — pre-fill from persisted map keyed by exe_path
        entry = tk.Entry(
            row,
            bg="#0f172a",
            fg=FG,
            insertbackground=FG,
            relief="flat",
            font=("Consolas", 9),
            width=24,
        )
        saved = self.mappings.get(win.exe_path) if win.exe_path else None
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
            # Persist by exe_path so we remember slot + character next time.
            if w.exe_path:
                self.mappings[w.exe_path] = SavedMapping(
                    exe_path=w.exe_path,
                    slot=w.slot or 0,
                    character=name,
                )

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
            save_mappings(self.mappings)
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
            ok = self.api.health()
            self.root.after(0, lambda: self._update_status(ok))
        threading.Thread(target=check, daemon=True).start()
        self.root.after(10000, self._check_health_periodically)

    def _update_status(self, ok: bool):
        if ok:
            self.status_lbl.configure(text="🟢 servidor online", fg=OK)
        else:
            self.status_lbl.configure(text="🔴 sem conexão com servidor", fg=BAD)

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
