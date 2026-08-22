"""
🥐 BakersWhisper — Bridge OCR (versão 3.x)
==========================================

Ponte entre múltiplas janelas do WoW e o painel Bakers Whisper.
- Lê a faixa preta/amarela que o addon WIMBridge desenha no topo
  da tela, via OCR nativo do Windows (winocr + mss).
- Envia os whispers recebidos para /api/ingest.
- Pega respostas pendentes em /api/queue e digita na janela certa.
- Tem uma janelinha (Tk) para configurar URL/token/personagens.
- Persiste a config em ~/.bakerswhisper/config.json

Como rodar (desenvolvimento):
    pip install -r requirements.txt
    python wim_bridge_ocr.py

Como gerar o .exe:
    pyinstaller --onefile --noconsole --name BakersWhisper ^
        --collect-all winocr --collect-submodules winrt ^
        public/downloads/wim_bridge_ocr.py
"""

from __future__ import annotations

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

# ---------------------------------------------------------------------------
# Imports opcionais (Windows)
# ---------------------------------------------------------------------------
try:
    import win32api
    import win32con  # noqa: F401
    import win32gui
    import win32ui
    import mss
    from PIL import Image
    HAS_WIN32 = True
except Exception:
    HAS_WIN32 = False

try:
    import winocr  # type: ignore
    HAS_WINOCR = True
except Exception:
    HAS_WINOCR = False

APP_NAME = "Bakers Whisper"
APP_VERSION = "3.0.1"

# Valores injetados pelo GitHub Actions (opcional).
DEFAULT_API_URL = os.environ.get("BRIDGE_OCR_API_URL", "http://localhost:3000").strip() or "http://localhost:3000"
DEFAULT_TOKEN = os.environ.get("BRIDGE_OCR_TOKEN", "").strip()

CONFIG_DIR = Path(os.environ.get("BAKERS_CONFIG_DIR") or Path.home() / ".bakerswhisper")
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_DIR = CONFIG_DIR / "logs"


# ===========================================================================
# Parser OCR (rejeita nomes com dígito — bug "bleedingh0110w")
# ===========================================================================
# Aceita "BW 48 FROM Draifu-Illidan: msg" (print do usuário).
# Realm pode ter letras E dígitos (Area52, Kazzak) — mas rejeita 3+ dígitos
# consecutivos, que seria o bug OCR "bleedingh0110w".
SCREEN_BW_RE = re.compile(
    r"\bB\s*W\s*#?\s*(?P<id>\d{1,10})?\s*"
    r"(?P<kind>FROM|TO)\s+"
    r"(?P<player>[A-Za-zÀ-ÿ'\-]{2,24}(?:-[A-Za-zÀ-ÿ0-9'\-]{2,24})?)\s*"
    r"[:\-]\s*(?P<body>.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)

GARBAGE_TAIL_RE = re.compile(
    r"\s+(?:World of Warcraft|FPS|MS|Objetivos|Missões|Guild|General|"
    r"Comércio|Trade|Guilda|Recrutando)\b",
    re.IGNORECASE,
)


def parse_strip(text: str) -> Optional[tuple[str, str, str, str]]:
    """Retorna (direction, strip_id, player, body) ou None.

    Rejeita nomes com 3+ dígitos consecutivos (bug OCR bleedingh0110w).
    Rejeita nomes que começam com dígito (o nome do personagem é só letras).
    """
    if not text:
        return None
    text = re.sub(r"\s+", " ", text).strip()
    m = SCREEN_BW_RE.search(text)
    if not m:
        return None
    strip_id = (m.group("id") or "").strip()
    kind = m.group("kind").upper()
    player = m.group("player").strip()
    body = GARBAGE_TAIL_RE.split(m.group("body"), maxsplit=1)[0].strip()
    if not player or not body:
        return None
    # Filtro anti-OCR: rejeita se houver 3+ dígitos consecutivos no nome
    # (sintoma clássico de "bleedingh0110w" — OCR trocou letras por números).
    if re.search(r"\d{3,}", player):
        return None
    # O nome do personagem (1º segmento) é estritamente alfabético.
    name_only = player.split("-", 1)[0]
    if not name_only.isalpha():
        return None
    return ("incoming" if kind == "FROM" else "outgoing", strip_id, player, body)


# ===========================================================================
# Captura + OCR
# ===========================================================================
def capture_window(hwnd: int) -> Image.Image:
    if not HAS_WIN32:
        raise RuntimeError("pywin32/mss ausentes — rode pip install -r requirements.txt")
    import ctypes
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width, height = max(1, right - left), max(1, bottom - top)
    window_dc = win32gui.GetWindowDC(hwnd)
    source_dc = win32ui.CreateDCFromHandle(window_dc)
    memory_dc = source_dc.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    bitmap.CreateCompatibleBitmap(source_dc, width, height)
    memory_dc.SelectObject(bitmap)
    try:
        ok = ctypes.windll.user32.PrintWindow(hwnd, memory_dc.GetSafeHdc(), 2)
        if not ok:
            ok = ctypes.windll.user32.PrintWindow(hwnd, memory_dc.GetSafeHdc(), 0)
        if not ok:
            raise RuntimeError("PrintWindow falhou")
        info = bitmap.GetInfo()
        bits = bitmap.GetBitmapBits(True)
        return Image.frombuffer(
            "RGB", (info["bmWidth"], info["bmHeight"]), bits,
            "raw", "BGRX", 0, 1,
        ).copy()
    finally:
        win32gui.DeleteObject(bitmap.GetHandle())
        memory_dc.DeleteDC()
        source_dc.DeleteDC()
        win32gui.ReleaseDC(hwnd, window_dc)


def crop_strip(image: Image.Image, top: int, height: int) -> Image.Image:
    w, h = image.size
    top = max(0, min(top, max(0, h - 60)))
    height = max(60, min(height, h - top))
    return image.crop((0, top, w, top + height))


def winocr_text(pil_image: Image.Image, lang: str = "en-US") -> str:
    if not HAS_WINOCR:
        raise RuntimeError("winocr indisponível")
    sync = getattr(winocr, "recognize_pil_sync", None)
    if callable(sync):
        for cand in (lang, lang.split("-", 1)[0] if "-" in lang else lang, "pt", "en"):
            try:
                result = sync(pil_image, cand) if cand else sync(pil_image)
                if isinstance(result, dict):
                    return str(result.get("text", ""))
                return str(getattr(result, "text", result or ""))
            except Exception:
                continue
    async_recognize = getattr(winocr, "recognize_pil", None)
    if callable(async_recognize):
        import asyncio

        async def _go():
            op = async_recognize(pil_image, lang)
            return await op

        result = asyncio.run(_go())
        if isinstance(result, dict):
            return str(result.get("text", ""))
        return str(getattr(result, "text", result or ""))
    raise RuntimeError("winocr incompatível")


# ===========================================================================
# Janelas
# ===========================================================================
WOW_TITLE_HINTS = ("world of warcraft", "wow")


def find_hwnd(title_substr: str) -> Optional[int]:
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


_VK: dict[str, int] = {
    "space": 0x20,
    "tab": 0x09,
    "enter": 0x0D,
    "esc": 0x1B,
}
for _i in range(10):
    _VK[str(_i)] = 0x30 + _i
for _i in range(26):
    _VK[chr(ord("a") + _i)] = 0x41 + _i
for _i in range(1, 25):
    _VK[f"f{_i}"] = 0x6F + _i


def post_key_to_window(hwnd: int, keybind: str) -> bool:
    """Envia uma tecla simples sem mudar a janela em foco.

    Não usa injeção, hooks nem tenta contornar proteções do jogo. Alguns
    clientes podem simplesmente ignorar WM_KEYDOWN em segundo plano; nesse
    caso a operação retorna sucesso ao Windows, mas o WoW continua sendo a
    autoridade sobre aceitar ou não o input.
    """
    if not HAS_WIN32 or not hwnd or "+" in keybind:
        return False
    vk = _VK.get(keybind.strip().lower())
    if not vk:
        return False
    try:
        scan = win32api.MapVirtualKey(vk, 0)
        down = (scan << 16) | 1
        up = (scan << 16) | 1 | (1 << 30) | (1 << 31)
        win32gui.PostMessage(hwnd, 0x0100, vk, down)
        win32gui.PostMessage(hwnd, 0x0101, vk, up)
        return True
    except Exception:
        return False
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def enum_wow_windows() -> list[dict]:
    if not HAS_WIN32:
        return []
    out: list[dict] = []
    try:
        fg = win32gui.GetForegroundWindow()
    except Exception:
        fg = None

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd) or ""
        low = title.lower()
        if not any(h in low for h in WOW_TITLE_HINTS):
            return
        if any(bad in low for bad in ("visual studio", "code -", "explorer")):
            return
        out.append({
            "hwnd": str(hwnd),
            "windowTitle": title,
            "foreground": hwnd == fg,
        })

    win32gui.EnumWindows(cb, None)
    return out


# ===========================================================================
# Envio
# ===========================================================================
def _press_key(key: str) -> None:
    try:
        import pydirectinput  # type: ignore
        pydirectinput.PAUSE = 0.0
        pydirectinput.press(key)
    except Exception:
        try:
            import pyautogui  # type: ignore
            pyautogui.PAUSE = 0.0
            pyautogui.press(key)
        except Exception:
            raise RuntimeError("Instale pydirectinput ou pyautogui")


def send_to_wow(character: str, window_title: str, player: str, body: str) -> None:
    if not focus_window(window_title):
        raise RuntimeError(f"janela '{window_title}' não encontrada")
    time.sleep(1.5)
    _press_key("enter")
    time.sleep(0.6)
    for ch in f"/w {player}":
        _press_key(ch)
        time.sleep(0.02)
    time.sleep(0.4)
    _press_key("space")
    time.sleep(0.7)
    for ch in body:
        _press_key(ch)
        time.sleep(0.02)
    time.sleep(0.3)
    _press_key("enter")
    time.sleep(0.4)
    _press_key("esc")


# ===========================================================================
# Config persistente
# ===========================================================================
@dataclass
class Character:
    name: str
    window_title: str
    ocr_top: int = 0
    # A faixa do addon pode ter 500–700px e o texto fica no centro dela.
    # 420px cobre a faixa mesmo com UI scale sem ler o chat normal abaixo.
    ocr_height: int = 420

    @classmethod
    def from_dict(cls, d: dict) -> "Character":
        return cls(
            name=d.get("name", "").strip(),
            window_title=d.get("window_title", "").strip(),
            ocr_top=int(d.get("ocr_top", 0) or 0),
            ocr_height=max(420, int(d.get("ocr_height", 420) or 420)),
        )

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "window_title": self.window_title,
            "ocr_top": self.ocr_top,
            "ocr_height": self.ocr_height,
        }


@dataclass
class AppConfig:
    api_url: str = DEFAULT_API_URL
    token: str = DEFAULT_TOKEN
    characters: list[Character] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "api_url": self.api_url,
            "token": self.token,
            "characters": [c.to_dict() for c in self.characters],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AppConfig":
        return cls(
            api_url=(d.get("api_url") or DEFAULT_API_URL).strip(),
            token=(d.get("token") or DEFAULT_TOKEN).strip(),
            characters=[Character.from_dict(x) for x in d.get("characters", []) if x.get("name")],
        )


def load_config() -> AppConfig:
    if not CONFIG_PATH.exists():
        return AppConfig()
    try:
        return AppConfig.from_dict(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except Exception:
        return AppConfig()


def save_config(cfg: AppConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")


# ===========================================================================
# Engine (OCR + send)
# ===========================================================================
class Engine:
    def __init__(self, cfg: AppConfig, log_cb, status_cb):
        self.cfg = cfg
        self.log_cb = log_cb
        self.status_cb = status_cb
        self.session = requests.Session()
        if cfg.token:
            self.session.headers["Authorization"] = f"Bearer {cfg.token}"
        self.session.headers["content-type"] = "application/json"
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self.seen_strip_ids: dict[str, set[str]] = {c.name: set() for c in cfg.characters}
        # Spammers GSE (um por personagem). Cada spammer é um thread que
        # pressiona a tecla configurada em loop na janela do personagem.
        # Antes de pressionar ele checa `paused` — o outgoing_worker
        # marca a flag enquanto digita uma resposta de whisper na mesma
        # janela, pra não intercalar PostMessages.
        self.spammers: dict[str, "GseSpammer"] = {}
        # Estado completo conhecido do GSE. /api/gse/poll envia somente
        # mudanças; sem este cache uma mudança em uma conta desligaria as
        # demais por engano.
        self._gse_configs: dict[str, dict] = {}
        self._gse_master_enabled = False

    def _log(self, msg: str) -> None:
        ts = time.strftime("%H:%M:%S")
        self.log_cb(f"[{ts}] {msg}")

    def _set_status(self, txt: str) -> None:
        self.status_cb(txt)

    def _ocr_loop(self, char: Character) -> None:
        interval = float(os.environ.get("BRIDGE_OCR_INTERVAL_S", "0.6") or 0.6)
        lang = os.environ.get("BRIDGE_OCR_LANG", "en-US") or "en-US"
        last_hash = None
        self._log(f"📷 OCR ativo para {char.name} (intervalo {interval}s)")

        while not self._stop.is_set():
            try:
                hwnd = find_hwnd(char.window_title)
                if not hwnd:
                    time.sleep(2.0)
                    continue
                image = capture_window(hwnd)
                # Configurações antigas salvavam 160px; esse valor não cobre
                # o texto central quando /wimbridge size está em 500–700.
                strip = crop_strip(image, char.ocr_top, max(420, char.ocr_height))
                h = hash(strip.tobytes())
                if h == last_hash:
                    time.sleep(interval)
                    continue
                last_hash = h
                text = winocr_text(strip, lang=lang)
                parsed = parse_strip(text)
                if not parsed:
                    time.sleep(interval)
                    continue
                direction, strip_id, player, body = parsed
                if strip_id:
                    seen = self.seen_strip_ids[char.name]
                    if strip_id in seen:
                        time.sleep(interval)
                        continue
                    seen.add(strip_id)
                    if len(seen) > 1000:
                        seen.clear()
                payload = [{
                    "externalId": f"ocr-{char.name}-{strip_id or int(time.time() // 8)}",
                    "character": char.name,
                    "player": player,
                    "body": body,
                    "direction": direction,
                    "status": "sent" if direction == "outgoing" else "received",
                    "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }]
                self._post("/api/ingest", {"messages": payload})
                # Atualiza o lastSeen da janela — assim a bolinha "online"
                # do painel não pisca mesmo se o scan periódico falhar.
                self._post("/api/status/scan", {
                    "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "windows": [{
                        "hwnd": str(hwnd),
                        "windowTitle": char.window_title,
                        "character": char.name,
                        "matched": True,
                        "foreground": True,
                    }],
                })
                arrow = "→" if direction == "outgoing" else "←"
                self._log(f"📷 {char.name} {arrow} {player}: {body}")
            except Exception as e:
                self._log(f"⚠ OCR [{char.name}]: {e}")
                time.sleep(1.0)
            else:
                time.sleep(interval)

    def _scan_loop(self) -> None:
        while not self._stop.is_set():
            try:
                wins = enum_wow_windows()
                for w in wins:
                    w["matched"] = any(c.window_title.lower() in w["windowTitle"].lower() for c in self.cfg.characters)
                    w["character"] = next(
                        (c.name for c in self.cfg.characters if c.window_title.lower() in w["windowTitle"].lower()),
                        "",
                    )
                self._post("/api/status/scan", {"windows": wins, "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            except Exception as e:
                self._log(f"⚠ scan: {e}")
            time.sleep(3.0)

    def _outgoing_loop(self) -> None:
        poll = 1.0
        while not self._stop.is_set():
            try:
                data = self._get("/api/queue")
            except Exception as e:
                self._log(f"⚠ queue: {e}")
                time.sleep(poll * 2)
                continue
            for msg in data.get("messages", []):
                mid = msg["id"]
                character = msg.get("character", "")
                player = msg["player"]
                body = msg["body"]
                char_cfg = next((c for c in self.cfg.characters if c.name == character), None)
                if not char_cfg:
                    self._log(f"❌ #{mid} personagem '{character}' não está na config")
                    self._post(f"/api/queue/{mid}/ack", {"status": "failed", "error": "personagem não configurado"})
                    continue
                # Pausa o spammer GSE desta conta enquanto digitamos o whisper
                # (evita que PostMessages do spammer se misturem com nossos keys)
                spammer = self.spammers.get(character)
                if spammer:
                    spammer.pause()
                try:
                    send_to_wow(character, char_cfg.window_title, player, body)
                    self._post(f"/api/queue/{mid}/ack", {"status": "sent"})
                    self._log(f"✅ #{mid} → {player}")
                except Exception as e:
                    self._log(f"❌ #{mid}: {e}")
                    self._post(f"/api/queue/{mid}/ack", {"status": "failed", "error": str(e)})
                finally:
                    if spammer:
                        spammer.resume()
                time.sleep(0.4)
            time.sleep(poll)

    def _gse_loop(self) -> None:
        """Lê /api/gse/poll a cada 1.5s e sincroniza os spammers.

        Usa o endpoint /api/gse/poll (com `since`) em vez de /api/gse.
        Vantagem: baixamos só o que mudou, e o intervalo cai pra 1.5s
        em vez de 3s — ou seja, do clique "Salvar & enviar" até o
        .exe aplicar a config, demora no máximo 1.5s.
        """
        last_poll_iso: Optional[str] = None
        control_checks = 0
        while not self._stop.is_set():
            try:
                url = "/api/gse/poll" + (f"?since={last_poll_iso}" if last_poll_iso else "")
                data = self._get(url)
                last_poll_iso = data.get("serverTime") or last_poll_iso
                # O endpoint /api/gse/poll já filtra por `since`. Se nada
                # mudou, items é []. Mesmo assim, ele devolve o status
                # atualizado de running, então a gente re-checa todos.
                items = data.get("items", [])
                for item in items:
                    character = str(item.get("character") or "").strip().lower()
                    if character:
                        self._gse_configs[character] = item

                # Pega o status de running de TODOS os personagens
                # (mesmo sem mudanças) — faz uma segunda chamada "cheia"
                # a cada 10 polls (≈ 15s) para detectar quando o usuário
                # pausa o spammer no site.
                self._gse_tick_counter = getattr(self, "_gse_tick_counter", 0) + 1
                if not self._gse_configs or self._gse_tick_counter % 10 == 0:
                    full = self._get("/api/gse")
                    self._gse_configs = {
                        str(item.get("character") or "").strip().lower(): item
                        for item in full.get("items", [])
                        if str(item.get("character") or "").strip()
                    }

                # O Master GSE é uma trava global. Consultamos em intervalo
                # curto, mas não em todo ciclo para reduzir chamadas ao site.
                control_checks += 1
                if control_checks % 4 == 1:
                    controls = self._get("/api/control").get("controls", {})
                    self._gse_master_enabled = bool(controls.get("gseMasterEnabled", False))

                wanted = {
                    char: config
                    for char, config in self._gse_configs.items()
                    if self._gse_master_enabled and config.get("running")
                }
                # Cria/atualiza spammers
                for char, cfg in wanted.items():
                    sp = self.spammers.get(char)
                    if sp is None:
                        sp = GseSpammer(
                            character=char,
                            window_title=next(
                                (c.window_title for c in self.cfg.characters if c.name.lower() == char),
                                char,
                            ),
                            log_cb=self._log,
                        )
                        sp.update_keybind(cfg["keybind"], int(cfg["intervalMs"]))
                        sp.start()
                        self.spammers[char] = sp
                        self._log(f"⌨️ spammer iniciado para {char} (tecla={cfg['keybind']}, {cfg['intervalMs']}ms)")
                    else:
                        sp.update_keybind(cfg["keybind"], int(cfg["intervalMs"]))
                # Remove spammers que não estão mais rodando
                for char in list(self.spammers.keys()):
                    if char not in wanted:
                        sp = self.spammers.pop(char)
                        sp.stop()
                        self._log(f"⏸ spammer parado para {char}")
            except Exception as e:
                self._log(f"⚠ gse poll: {e}")
            time.sleep(1.5)

    def _post(self, path: str, payload: dict) -> dict:
        url = f"{self.cfg.api_url.rstrip('/')}{path}"
        r = self.session.post(url, json=payload, timeout=10)
        r.raise_for_status()
        try:
            return r.json()
        except Exception:
            return {}

    def _get(self, path: str) -> dict:
        url = f"{self.cfg.api_url.rstrip('/')}{path}"
        r = self.session.get(url, timeout=10)
        r.raise_for_status()
        return r.json()

    def start(self) -> None:
        if self._threads:
            return
        self._stop.clear()
        for c in self.cfg.characters:
            t = threading.Thread(target=self._ocr_loop, args=(c,), daemon=True, name=f"ocr-{c.name}")
            t.start()
            self._threads.append(t)
        for name, target in (
            ("scan", self._scan_loop),
            ("outgoing", self._outgoing_loop),
            ("gse", self._gse_loop),
        ):
            t = threading.Thread(target=target, daemon=True, name=name)
            t.start()
            self._threads.append(t)
        self._set_status(f"🟢 rodando com {len(self.cfg.characters)} personagem(ns)")
        self._log(f"🚀 bridge iniciado ({len(self.cfg.characters)} personagem(ns))")

    def stop(self) -> None:
        self._stop.set()
        for sp in self.spammers.values():
            sp.stop()
        self.spammers.clear()
        self._threads.clear()
        self._set_status("⏸ parado")
        self._log("⏹ bridge parado")


# ===========================================================================
# GSE Spammer — pressiona uma tecla em loop na janela do personagem
# ===========================================================================
class GseSpammer:
    """Mantém o estado mais recente de (keybind, intervalMs) e pressiona
    a tecla em loop. `pause()` interrompe o loop até `resume()` (usado
    quando vamos digitar uma resposta de whisper na mesma janela).
    """

    def __init__(self, character: str, window_title: str, log_cb):
        self.character = character
        self.window_title = window_title
        self._log = log_cb
        self._keybind = "1"
        self._interval_ms = 100
        self._lock = threading.Lock()
        self._paused = threading.Event()
        self._paused.set()  # começa pausado até o Engine ligar
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name=f"gse-{character}",
        )

    def start(self) -> None:
        self._paused.clear()
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._paused.set()  # libera o wait

    def update_keybind(self, keybind: str, interval_ms: int) -> None:
        with self._lock:
            self._keybind = keybind
            self._interval_ms = max(20, min(10_000, int(interval_ms)))

    def pause(self) -> None:
        # Marca "estou ocupado" — o _run checa isso no topo do loop
        self._busy = True

    def resume(self) -> None:
        self._busy = False

    def _run(self) -> None:
        import time
        while not self._stop.is_set():
            if getattr(self, "_busy", False):
                time.sleep(0.05)
                continue
            hwnd = find_hwnd(self.window_title)
            if not hwnd:
                time.sleep(1.0)
                continue
            with self._lock:
                keybind = self._keybind
            if not post_key_to_window(hwnd, keybind):
                self._log(
                    f"⌨️ {self.character}: tecla {keybind!r} não é suportada "
                    "em segundo plano (use uma tecla simples, como 1 ou F5)."
                )
                time.sleep(1.0)
                continue
            with self._lock:
                sleep_s = self._interval_ms / 1000.0
            time.sleep(sleep_s)


# ===========================================================================
# GUI Tk
# ===========================================================================
class App:
    BG = "#0f172a"
    CARD = "#1e293b"
    FG = "#e2e8f0"
    MUTED = "#94a3b8"
    ACCENT = "#10b981"
    ACCENT_DARK = "#047857"

    def __init__(self, root: tk.Tk):
        self.root = root
        self.config = load_config()
        self.engine: Optional[Engine] = None
        self.log_queue: queue.Queue[str] = queue.Queue()

        root.title(f"{APP_NAME} v{APP_VERSION}")
        root.geometry("780x620")
        root.configure(bg=self.BG)
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        self._build_ui()
        self._flush_log_periodically()
        self._refresh_chars()
        self._set_status("⏸ parado")

    def _build_ui(self):
        header = tk.Frame(self.root, bg=self.BG)
        header.pack(fill="x", padx=16, pady=(14, 6))
        tk.Label(
            header, text=f"🥐 {APP_NAME}", bg=self.BG, fg=self.ACCENT,
            font=("Segoe UI", 16, "bold"),
        ).pack(side="left")
        tk.Label(
            header, text=f"v{APP_VERSION}", bg=self.BG, fg=self.MUTED,
            font=("Segoe UI", 9),
        ).pack(side="left", padx=(8, 0), pady=(4, 0))
        self.status_lbl = tk.Label(
            header, text="⏸ parado", bg=self.BG, fg=self.MUTED, font=("Segoe UI", 9),
        )
        self.status_lbl.pack(side="right")

        # Server card
        server = tk.LabelFrame(self.root, text=" Servidor ", bg=self.CARD, fg=self.ACCENT,
                                font=("Segoe UI", 9, "bold"), padx=10, pady=8)
        server.pack(fill="x", padx=16, pady=(0, 8))
        tk.Label(server, text="URL da API", bg=self.CARD, fg=self.MUTED, font=("Segoe UI", 8)).grid(row=0, column=0, sticky="w")
        self.api_url_var = tk.StringVar(value=self.config.api_url)
        tk.Entry(server, textvariable=self.api_url_var, bg="#0f172a", fg=self.FG,
                 insertbackground=self.FG, font=("Consolas", 9), width=56
                 ).grid(row=0, column=1, sticky="we", padx=(8, 0), pady=2)
        tk.Label(server, text="Token", bg=self.CARD, fg=self.MUTED, font=("Segoe UI", 8)).grid(row=1, column=0, sticky="w")
        self.token_var = tk.StringVar(value=self.config.token)
        tk.Entry(server, textvariable=self.token_var, show="•", bg="#0f172a", fg=self.FG,
                 insertbackground=self.FG, font=("Consolas", 9), width=56
                 ).grid(row=1, column=1, sticky="we", padx=(8, 0), pady=2)
        server.columnconfigure(1, weight=1)

        # Characters card
        chars_frame = tk.LabelFrame(self.root, text=" Personagens ", bg=self.CARD, fg=self.ACCENT,
                                     font=("Segoe UI", 9, "bold"), padx=10, pady=8)
        chars_frame.pack(fill="both", expand=True, padx=16, pady=(0, 8))

        input_row = tk.Frame(chars_frame, bg=self.CARD)
        input_row.pack(fill="x", pady=(0, 6))
        tk.Label(input_row, text="Personagem (com realm):", bg=self.CARD, fg=self.MUTED,
                 font=("Segoe UI", 8)).grid(row=0, column=0, sticky="w")
        self.char_name_var = tk.StringVar()
        tk.Entry(input_row, textvariable=self.char_name_var, bg="#0f172a", fg=self.FG,
                 insertbackground=self.FG, font=("Consolas", 9), width=24
                 ).grid(row=0, column=1, padx=(6, 12))
        tk.Label(input_row, text="Título da janela:", bg=self.CARD, fg=self.MUTED,
                 font=("Segoe UI", 8)).grid(row=0, column=2, sticky="w")
        self.char_title_var = tk.StringVar()
        tk.Entry(input_row, textvariable=self.char_title_var, bg="#0f172a", fg=self.FG,
                 insertbackground=self.FG, font=("Consolas", 9), width=28
                 ).grid(row=0, column=3, padx=(6, 6), sticky="we")
        input_row.columnconfigure(3, weight=1)
        tk.Button(input_row, text="➕ Adicionar", command=self._add_char,
                  bg=self.ACCENT_DARK, fg="white", relief="flat", padx=10,
                  font=("Segoe UI", 8, "bold")).grid(row=0, column=4, padx=(6, 0))

        # List
        list_frame = tk.Frame(chars_frame, bg=self.CARD)
        list_frame.pack(fill="both", expand=True)
        cols = ("character", "title")
        self.tree = ttk.Treeview(list_frame, columns=cols, show="headings", height=5)
        self.tree.heading("character", text="Personagem")
        self.tree.heading("title", text="Título da janela do WoW")
        self.tree.column("character", width=200, anchor="w")
        self.tree.column("title", width=400, anchor="w")
        self.tree.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(list_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        ttk.Button(chars_frame, text="🗑 Remover selecionado", command=self._remove_char
                   ).pack(anchor="e", pady=(4, 0))

        style = ttk.Style()
        style.theme_use("default")
        style.configure("Treeview", background="#0f172a", foreground=self.FG, fieldbackground="#0f172a", rowheight=22)
        style.configure("Treeview.Heading", background="#1e293b", foreground=self.ACCENT, relief="flat")
        style.map("Treeview", background=[("selected", self.ACCENT_DARK)])

        # Buttons
        btn_row = tk.Frame(self.root, bg=self.BG)
        btn_row.pack(fill="x", padx=16, pady=(0, 8))
        self.start_btn = tk.Button(btn_row, text="▶ Iniciar", command=self._toggle,
                                    bg=self.ACCENT, fg="white", relief="flat",
                                    padx=18, font=("Segoe UI", 10, "bold"))
        self.start_btn.pack(side="left")
        tk.Button(btn_row, text="💾 Salvar", command=self._save,
                  bg="#334155", fg=self.FG, relief="flat", padx=14
                  ).pack(side="left", padx=(8, 0))
        tk.Button(btn_row, text="🪟 Detectar janelas", command=self._detect_windows,
                  bg="#334155", fg=self.FG, relief="flat", padx=14
                  ).pack(side="left", padx=(8, 0))

        # Log
        log_frame = tk.LabelFrame(self.root, text=" Log ", bg=self.CARD, fg=self.ACCENT,
                                   font=("Segoe UI", 9, "bold"), padx=6, pady=6)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(0, 12))
        self.log_box = scrolledtext.ScrolledText(
            log_frame, height=10, bg="#0f172a", fg="#cbd5e1",
            font=("Consolas", 8), relief="flat", insertbackground=self.FG,
        )
        self.log_box.pack(fill="both", expand=True)
        self.log_box.configure(state="disabled")

    def _add_char(self):
        name = self.char_name_var.get().strip().lower()
        title = self.char_title_var.get().strip()
        if not name or not title:
            messagebox.showwarning(APP_NAME, "Preencha Personagem e Título da janela.")
            return
        if not re.match(r"^[a-zà-ÿ'\-]{2,24}(-[a-zà-ÿ'\-]{2,24})?$", name):
            messagebox.showwarning(APP_NAME, f"Nome inválido: '{name}'.\nUse só letras (ex: bakerz-area52).")
            return
        if any(c.name == name for c in self.config.characters):
            messagebox.showwarning(APP_NAME, "Esse personagem já está na lista.")
            return
        self.config.characters.append(Character(name=name, window_title=title))
        self._refresh_chars()
        self.char_name_var.set("")
        self.char_title_var.set("")
        self._save()

    def _remove_char(self):
        sel = self.tree.selection()
        if not sel:
            return
        for s in sel:
            name = self.tree.item(s)["values"][0]
            self.config.characters = [c for c in self.config.characters if c.name != name]
        self._refresh_chars()
        self._save()

    def _refresh_chars(self):
        for row in self.tree.get_children():
            self.tree.delete(row)
        for c in self.config.characters:
            self.tree.insert("", "end", values=(c.name, c.window_title))

    def _save(self):
        self.config.api_url = self.api_url_var.get().strip()
        self.config.token = self.token_var.get().strip()
        save_config(self.config)
        self._log("💾 configuração salva")

    def _toggle(self):
        if self.engine and self.engine._threads:
            self.engine.stop()
            self.engine = None
            self.start_btn.configure(text="▶ Iniciar", bg=self.ACCENT)
        else:
            self._save()
            if not self.config.characters:
                messagebox.showwarning(APP_NAME, "Adicione pelo menos um personagem antes de iniciar.")
                return
            try:
                self.engine = Engine(self.config, self._log, self._set_status)
            except Exception as e:
                messagebox.showerror(APP_NAME, f"Erro ao iniciar:\n\n{e}")
                return
            self.engine.start()
            self.start_btn.configure(text="⏸ Parar", bg="#dc2626")

    def _detect_windows(self):
        wins = enum_wow_windows()
        if not wins:
            messagebox.showinfo(APP_NAME, "Nenhuma janela do WoW encontrada.")
            return
        for w in wins:
            self._log(f"🪟 detectada: {w['windowTitle']} (hwnd={w['hwnd']})")

    def _flush_log_periodically(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.log_box.configure(state="normal")
                self.log_box.insert("end", msg + "\n")
                self.log_box.see("end")
                self.log_box.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(120, self._flush_log_periodically)

    def _log(self, msg: str):
        self.log_queue.put(msg)

    def _set_status(self, txt: str):
        self.status_lbl.configure(text=txt)

    def _on_close(self):
        if self.engine:
            self.engine.stop()
        self.root.destroy()


def main():
    if not HAS_WIN32:
        # Mostra erro amigável mesmo sem console
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            APP_NAME,
            "Este programa é exclusivo para Windows 10/11 (64 bits).\n\n"
            "Ele precisa do pywin32 e do OCR nativo do Windows.",
        )
        return
    if not HAS_WINOCR:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            APP_NAME,
            "OCR do Windows (winocr) não está instalado.\n\n"
            "Rode: pip install -r requirements.txt\n"
            "Ou reinstale o BakersWhisper.exe (já vem com tudo embutido).",
        )
        return

    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
