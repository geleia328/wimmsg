"""
WIM Bridge — Python client (multi-window edition)
=================================================

Ponte entre múltiplas janelas do WoW rodando no seu PC e o painel web.

Todo conteúdo que sai é escrito por você MANUALMENTE no site — o Python
apenas entrega a mensagem já digitada na janela correta.

Fluxo:
    1) Para cada personagem configurado em config.ini, observa o
       WoWChatLog.txt correspondente (ative com /chatlog no jogo) e
       identifica whispers recebidos. Cada whisper novo é enviado ao site
       via POST /api/ingest com o campo `character`.
    2) Faz polling em GET /api/queue procurando respostas suas. Para cada
       resposta pendente, foca a JANELA correspondente ao personagem que
       vai enviar (usando window_title do config) e digita /w Nome msg.
    3) Confirma o envio ao site via POST /api/queue/{id}/ack.

Requisitos:
    pip install -r requirements.txt
    Recomendado: Windows (pywin32 para focar janelas por título).

Uso:
    python wim_bridge.py
"""
from __future__ import annotations

import configparser
import hashlib
import logging
import os
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import requests

try:
    import pydirectinput  # type: ignore
    pydirectinput.PAUSE = 0.0
    HAS_PYDIRECTINPUT = True
except Exception:  # pragma: no cover
    HAS_PYDIRECTINPUT = False

try:
    import pyautogui  # type: ignore
    HAS_PYAUTOGUI = True
except Exception:  # pragma: no cover
    HAS_PYAUTOGUI = False

try:
    import win32gui  # type: ignore
    import win32con  # type: ignore
    HAS_WIN32 = True
except Exception:  # pragma: no cover
    HAS_WIN32 = False


# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("wim-bridge")


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
@dataclass
class CharacterConfig:
    name: str            # "Aragorn-Nemesis"
    chat_log: Path
    window_title: str


@dataclass
class Config:
    api_url: str
    token: str
    poll_interval: float
    type_delay: float
    auto_focus: bool
    characters: list[CharacterConfig] = field(default_factory=list)

    @classmethod
    def load(cls, path: str = "config.ini") -> "Config":
        cp = configparser.ConfigParser()
        if not Path(path).exists():
            log.error("config.ini não encontrado. Copie config.example.ini.")
            sys.exit(1)
        cp.read(path, encoding="utf-8")

        b = cp["bridge"] if cp.has_section("bridge") else {}
        api_url = (b.get("api_url", "http://localhost:3000") if b else "http://localhost:3000").rstrip("/")
        token = (b.get("token", "").strip() if b else "")
        poll_interval = float((b.get("poll_interval", "1.0") if b else "1.0"))
        type_delay = float((b.get("type_delay", "0.02") if b else "0.02"))
        auto_focus = str((b.get("auto_focus", "true") if b else "true")).lower() in ("1", "true", "yes", "on")

        characters: list[CharacterConfig] = []
        for section in cp.sections():
            if not section.startswith("character:"):
                continue
            name = section.split("character:", 1)[1].strip()
            chat_log = Path(cp[section].get("chat_log", "").strip())
            window_title = cp[section].get("window_title", "").strip()
            if not name or not chat_log or not window_title:
                log.warning("Seção %s incompleta — ignorando.", section)
                continue
            characters.append(
                CharacterConfig(name=name, chat_log=chat_log, window_title=window_title)
            )

        if not characters:
            log.error(
                "Nenhum [character:...] configurado em config.ini. Adicione "
                "pelo menos um bloco (veja config.example.ini)."
            )
            sys.exit(1)

        return cls(
            api_url=api_url,
            token=token,
            poll_interval=poll_interval,
            type_delay=type_delay,
            auto_focus=auto_focus,
            characters=characters,
        )


# --------------------------------------------------------------------------
# HTTP client
# --------------------------------------------------------------------------
class ApiClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.s = requests.Session()
        if cfg.token:
            self.s.headers["Authorization"] = f"Bearer {cfg.token}"
        self.s.headers["content-type"] = "application/json"

    def _url(self, path: str) -> str:
        return f"{self.cfg.api_url}{path}"

    def ingest(self, msgs: list[dict]) -> None:
        if not msgs:
            return
        r = self.s.post(self._url("/api/ingest"), json={"messages": msgs}, timeout=10)
        r.raise_for_status()
        data = r.json()
        log.info("ingest: %d/%d nova(s)", data.get("inserted", 0), len(msgs))

    def fetch_queue(self) -> list[dict]:
        r = self.s.get(self._url("/api/queue"), timeout=10)
        r.raise_for_status()
        return r.json().get("messages", [])

    def ack(self, mid: int, status: str, error: Optional[str] = None) -> None:
        payload: dict = {"status": status}
        if error:
            payload["error"] = error
        r = self.s.post(self._url(f"/api/queue/{mid}/ack"), json=payload, timeout=10)
        r.raise_for_status()

    def scan(self, windows: list[dict]) -> None:
        r = self.s.post(
            self._url("/api/status/scan"),
            json={
                "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "windows": windows,
            },
            timeout=10,
        )
        r.raise_for_status()


# --------------------------------------------------------------------------
# Whisper parsing
# --------------------------------------------------------------------------
TIMESTAMP_RE = re.compile(r"^\d+/\d+\s+\d+:\d+:\d+\.\d+\s+")

# Preferred format (from WIMBridge addon):
#   [WIMBRIDGE]<OWN:MyChar-Realm><FROM:Sender-Realm><TS:...>message
ADDON_RE = re.compile(
    r"^\[WIMBRIDGE\]<OWN:(?P<own>[^>]+)><(?P<kind>FROM|TO):(?P<other>[^>]+)>"
    r"(?:<TS:(?P<ts>[^>]+)>)?(?P<body>.*)$"
)
RELAY_RE = re.compile(
    r"^\[WIMRELAY\]<OWN:(?P<own>[^>]+)><FROM:(?P<from>[^>]+)>"
    r"<TS:(?P<ts>[^>]+)>(?P<body>.*)$"
)
NATIVE_TAG_RE = re.compile(r"^\[W (?P<kind>From|To)\]\s+(?P<rest>.*)$")
NATIVE_NAME_RE = re.compile(
    r"^(?:\[(?P<name>[^\]]+)\]|(?P<name2>[A-Za-zÀ-ÿ0-9_'\-]+))"
    r"(?:\s+whispers?)?:\s*(?P<body>.*)$", re.I
)

# Fallbacks (no addon):
#   "Sender whispers: hello"   (EN)
#   "Sender sussurra: hello"   (pt-BR)
FALLBACK_RES = [
    re.compile(r"^(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?)\s+whispers?:\s+(?P<body>.+)$"),
    re.compile(r"^(?P<from>[A-Za-zÀ-ÿ0-9_'\-]+(?:-[A-Za-zÀ-ÿ0-9_'\-]+)?)\s+sussurra:\s+(?P<body>.+)$"),
]


def clean_line(line: str) -> str:
    line = line.rstrip("\r\n")
    line = TIMESTAMP_RE.sub("", line).strip()
    line = re.sub(r"\|c[0-9a-fA-F]{8}", "", line)
    line = re.sub(r"\|H[^|]*\|h", "", line)
    return line.replace("|h", "").replace("|r", "").replace("[", "").replace("]", "")


def parse_whisper(line: str, fallback_own: str) -> Optional[tuple[str, str, str]]:
    """Return (own_character, sender, body) for incoming whispers.

    The legacy CLI keeps the same public tuple as before; outgoing lines and
    addon relay lines are converted into the incoming side when applicable.
    """
    original = line
    line = clean_line(line)
    addon_line = TIMESTAMP_RE.sub("", original.strip()).strip()
    structured = TIMESTAMP_RE.sub("", original.strip()).strip()
    structured = re.sub(r"\|c[0-9a-fA-F]{8}", "", structured)
    structured = re.sub(r"\|H[^|]*\|h", "", structured)
    structured = structured.replace("|h", "").replace("|r", "")
    m = ADDON_RE.match(structured)
    if m:
        kind = m.group("kind")
        other = m.group("other").strip()
        body = m.group("body").strip()
        if kind == "FROM":
            return m.group("own").strip(), other, body
        return None

    clean = structured
    native = NATIVE_TAG_RE.match(clean)
    if native:
        nm = NATIVE_NAME_RE.match(native.group("rest"))
        if nm:
            other = (nm.group("name") or nm.group("name2") or "").strip()
            body = nm.group("body").strip()
            relay = RELAY_RE.match(body)
            if relay:
                return relay.group("own").strip() or fallback_own, relay.group("from").strip(), relay.group("body").strip()
            if native.group("kind") == "From":
                return fallback_own, other, body

    for pat in FALLBACK_RES:
        m = pat.match(line)
        if m:
            return fallback_own, m.group("from").strip(), m.group("body").strip()
    return None


# --------------------------------------------------------------------------
# Log tailer
# --------------------------------------------------------------------------
def tail_file(path: Path, from_end: bool = True) -> Iterable[str]:
    """Yield new lines appended to `path`. Handles file rotation."""
    while not path.exists():
        log.warning("Chat log ainda não existe: %s (ative com /chatlog).", path)
        time.sleep(3)

    fh = open(path, "r", encoding="utf-8", errors="replace")
    if from_end:
        fh.seek(0, os.SEEK_END)
    try:
        inode = os.stat(path).st_ino
    except (AttributeError, OSError):
        inode = None
    size = fh.tell()

    while True:
        line = fh.readline()
        if line:
            yield line
            continue
        time.sleep(0.5)
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
            log.info("Chat log recriado — reabrindo: %s", path)
            fh.close()
            fh = open(path, "r", encoding="utf-8", errors="replace")
            inode = new_inode
            size = 0
        else:
            size = st.st_size


def make_external_id(character: str, player: str, body: str) -> str:
    h = hashlib.sha1(
        f"{time.time():.3f}|{character}|{player}|{body}".encode("utf-8")
    ).hexdigest()
    return f"in-{h[:16]}"


# --------------------------------------------------------------------------
# Window focus (Windows)
# --------------------------------------------------------------------------
def find_hwnd(title_substr: str):
    if not HAS_WIN32:
        return None
    found = {"h": None}

    def cb(hwnd, _):
        title = win32gui.GetWindowText(hwnd)
        if title_substr.lower() in title.lower() and win32gui.IsWindowVisible(hwnd):
            found["h"] = hwnd

    win32gui.EnumWindows(cb, None)
    return found["h"]


def focus_window(title_substr: str) -> bool:
    hwnd = find_hwnd(title_substr)
    if not hwnd:
        return False
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        return True
    except Exception as e:
        log.warning("Não consegui focar '%s': %s", title_substr, e)
        return False


# --------------------------------------------------------------------------
# Window scanner — enumerates every open WoW client on the machine
# --------------------------------------------------------------------------
# Titles used by the official client. Add/remove as your setup requires.
WOW_TITLE_HINTS = (
    "world of warcraft",
    "wow",  # generic fallback (matches "WoW - Aragorn" etc.)
)


def _get_pid_for_hwnd(hwnd) -> str:
    if not HAS_WIN32:
        return ""
    try:
        import win32process  # type: ignore
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        return str(pid)
    except Exception:
        return ""


def enum_wow_windows() -> list[dict]:
    """Return a list of dicts describing every visible WoW window."""
    if not HAS_WIN32:
        return []
    results: list[dict] = []

    try:
        fg_hwnd = win32gui.GetForegroundWindow()
    except Exception:
        fg_hwnd = None

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ""
        if not title:
            return
        low = title.lower()
        # Only keep windows that look like WoW clients.
        if not any(hint in low for hint in WOW_TITLE_HINTS):
            return
        # Skip our own console / editor windows accidentally titled "wow".
        # Heuristic: the title must be short-ish AND not contain "code", etc.
        if any(bad in low for bad in ("visual studio", "code -", "explorer")):
            return
        results.append(
            {
                "hwnd": str(hwnd),
                "pid": _get_pid_for_hwnd(hwnd),
                "windowTitle": title,
                "foreground": hwnd == fg_hwnd,
            }
        )

    win32gui.EnumWindows(cb, None)
    return results


def build_scan_payload(cfg: Config) -> list[dict]:
    windows = enum_wow_windows()
    for w in windows:
        # Match a configured character by substring on window_title.
        matched_char = ""
        for c in cfg.characters:
            if c.window_title and c.window_title.lower() in w["windowTitle"].lower():
                matched_char = c.name
                break
        w["character"] = matched_char
        w["matched"] = bool(matched_char)
    return windows


# --------------------------------------------------------------------------
# Send to WoW
# --------------------------------------------------------------------------
_send_lock = threading.Lock()  # only one window may be focused at a time


def send_to_wow(cfg: Config, character: str, player: str, body: str) -> None:
    if not HAS_PYDIRECTINPUT and not HAS_PYAUTOGUI:
        raise RuntimeError(
            "Nem pydirectinput nem pyautogui instalados. Rode "
            "`pip install -r requirements.txt`."
        )

    char_cfg = next((c for c in cfg.characters if c.name == character), None)
    if not char_cfg:
        raise RuntimeError(
            f"Character '{character}' não está no config.ini — adicione uma "
            f"seção [character:{character}]."
        )

    with _send_lock:
        if cfg.auto_focus:
            if not focus_window(char_cfg.window_title):
                raise RuntimeError(
                    f"janela contendo '{char_cfg.window_title}' não encontrada"
                )
            time.sleep(0.20)  # let WoW receive focus

        # Type: <Enter> /w Player message <Enter>
        if HAS_PYDIRECTINPUT:
            pydirectinput.press("enter")
        elif HAS_PYAUTOGUI:
            pyautogui.press("enter")
        time.sleep(0.08)

        command = f"/w {player} {body}"
        if HAS_PYAUTOGUI:
            pyautogui.typewrite(command, interval=cfg.type_delay)
        else:
            for ch in command:
                pydirectinput.write(ch, interval=cfg.type_delay)
        time.sleep(0.05)

        if HAS_PYDIRECTINPUT:
            pydirectinput.press("enter")
        else:
            pyautogui.press("enter")


# --------------------------------------------------------------------------
# Workers
# --------------------------------------------------------------------------
def incoming_worker(cfg: Config, api: ApiClient, char_cfg: CharacterConfig) -> None:
    log.info("[%s] observando: %s", char_cfg.name, char_cfg.chat_log)
    buffer: list[dict] = []
    last_flush = time.time()
    for line in tail_file(char_cfg.chat_log, from_end=True):
        parsed = parse_whisper(line, fallback_own=char_cfg.name)
        if parsed:
            own, sender, body = parsed
            # Use the OWN field from the addon if present; else the char that
            # owns this log file.
            character = own or char_cfg.name
            log.info("← [%s] whisper de %s: %s", character, sender, body)
            buffer.append(
                {
                    "externalId": make_external_id(character, sender, body),
                    "character": character,
                    "player": sender,
                    "body": body,
                    "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            )
        if buffer and (len(buffer) >= 10 or time.time() - last_flush > 1.5):
            try:
                api.ingest(buffer)
                buffer.clear()
                last_flush = time.time()
            except Exception as e:
                log.error("[%s] falha no ingest: %s", char_cfg.name, e)
                time.sleep(2)


def scan_worker(cfg: Config, api: ApiClient) -> None:
    """Enumerate WoW windows every few seconds and POST to /api/status/scan."""
    while True:
        try:
            windows = build_scan_payload(cfg)
            api.scan(windows)
            if windows:
                log.debug("scan: %d janela(s) detectada(s)", len(windows))
        except Exception as e:
            log.error("scan falhou: %s", e)
        time.sleep(3.0)


def outgoing_worker(cfg: Config, api: ApiClient) -> None:
    while True:
        try:
            pending = api.fetch_queue()
        except Exception as e:
            log.error("falha ao buscar fila: %s", e)
            time.sleep(cfg.poll_interval * 2)
            continue

        for msg in pending:
            mid = msg["id"]
            character = msg.get("character") or ""
            player = msg["player"]
            body = msg["body"]
            log.info("→ #%d [%s → %s]: %s", mid, character, player, body)
            try:
                send_to_wow(cfg, character, player, body)
                api.ack(mid, "sent")
            except Exception as e:
                log.error("erro em #%d: %s", mid, e)
                try:
                    api.ack(mid, "failed", error=str(e))
                except Exception:
                    pass
            time.sleep(0.25)  # gentle spacing between different sends

        time.sleep(cfg.poll_interval)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main() -> None:
    cfg = Config.load()
    log.info("api: %s", cfg.api_url)
    log.info("personagens configurados: %d", len(cfg.characters))
    for c in cfg.characters:
        log.info("  - %s | %s | title~='%s'", c.name, c.chat_log, c.window_title)

    if not (HAS_PYDIRECTINPUT or HAS_PYAUTOGUI):
        log.warning("pydirectinput/pyautogui ausentes — só ingestão funcionará.")
    if not HAS_WIN32 and cfg.auto_focus:
        log.warning("pywin32 ausente — auto_focus desativado.")
        cfg.auto_focus = False

    api = ApiClient(cfg)

    # De-duplicate log paths: if várias janelas apontam para o mesmo log,
    # basta uma única thread lendo-o. O addon já grava <OWN:...> em cada
    # linha, então a distinção é preservada.
    seen_logs: set[Path] = set()
    threads: list[threading.Thread] = []
    for char in cfg.characters:
        if char.chat_log in seen_logs:
            log.info(
                "[%s] compartilha chat log com outra janela — reutilizando o tailer.",
                char.name,
            )
            continue
        seen_logs.add(char.chat_log)
        t = threading.Thread(
            target=incoming_worker, args=(cfg, api, char), daemon=True
        )
        t.start()
        threads.append(t)

    outgoing = threading.Thread(target=outgoing_worker, args=(cfg, api), daemon=True)
    outgoing.start()

    scanner = threading.Thread(target=scan_worker, args=(cfg, api), daemon=True)
    scanner.start()

    log.info(
        "bridge rodando: %d tailer(s), 1 sender, 1 scanner. Ctrl+C para sair.",
        len(threads),
    )
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        log.info("encerrando.")


if __name__ == "__main__":
    main()
