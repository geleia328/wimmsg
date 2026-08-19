"""Bakers Whisper Windows bridge: WoW chatlog, combatlog, OCR, queue and GSE automation."""
from __future__ import annotations
import asyncio, json, os, queue, re, threading, time, webbrowser
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Optional
import requests
try:
    import psutil, win32api, win32con, win32gui, win32process
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False
try:
    import pydirectinput as keyboard
except ImportError:
    try:
        import pyautogui as keyboard
    except ImportError:
        keyboard = None
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
try:
    import winocr
    HAS_WINOCR = True
except ImportError:
    HAS_WINOCR = False
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    HAS_SR = False

import tkinter as tk
from tkinter import messagebox, scrolledtext

APP_NAME = "BakersWhisper"
APP_VERSION = "1.0.8"
API_URL = "https://wimmsg-lntm.vercel.app"
BRIDGE_TOKEN = "COLE_SEU_TOKEN_AQUI"
DATA_DIR = Path(os.getenv("APPDATA", Path.home() / ".config")) / APP_NAME
CONFIG_FILE = DATA_DIR / "config.json"

ADDON_RE = re.compile(r"\[WIMBRIDGE\]<OWN:([^>]+)><FROM:([^>]+)>(.*)")
TIMESTAMP_RE = re.compile(r"^\s*\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\s+")
COMBAT_WHISPER_RE = re.compile(r"CHAT_MSG_WHISPER.*\[(YOUR?|PLAYER)_CHAT\])?\s*\|\w+\|Hplayer:([^|]+)\|h\[([^]]+)\]\|h.*\]:\s*(.+)$")

DEFAULT_CONTROLS = {
    "bridgeReaderEnabled": True, "gseMasterEnabled": False,
    "whisperFocusDelayMs": 2000, "whisperAfterSendDelayMs": 1000,
    "whisperChatOpenDelayMs": 1000, "whisperKeystrokeDelayMs": 100,
    "whisperChatSendDelayMs": 1000, "whisperCloseChatEnabled": True,
    "whisperChatCloseDelayMs": 500, "voiceRelayEnabled": False,
    "combatRelayEnabled": False, "ocrRelayEnabled": False,
    "wimScreenOcrEnabled": False, "queuePollMs": 1500,
}


@dataclass
class ServerSettings:
    api_url: str = API_URL
    token: str = BRIDGE_TOKEN


@dataclass
class SavedMapping:
    exe_path: str = ""
    slot: int = 0
    character: str = ""


@dataclass
class AppConfig:
    server: ServerSettings = field(default_factory=ServerSettings)
    mappings: dict = field(default_factory=dict)
    rename_on_start: bool = True


@dataclass
class DetectedWindow:
    hwnd: int
    pid: int
    title: str
    exe_path: str
    chat_log: Path = Path()
    combat_log: Path = Path()
    foreground: bool = False
    slot: int = 0


@dataclass
class RuntimeCharacter:
    character: str
    window: DetectedWindow


def load_config():
    try:
        raw = json.loads(CONFIG_FILE.read_text("utf-8"))
        server = ServerSettings(**raw.get("server", {}))
        maps = {}
        for key, val in raw.get("mappings", {}).items():
            item = SavedMapping(**val)
            maps[key if key.startswith("slot:") else f"slot:{item.slot}"] = item
        return AppConfig(server, maps, bool(raw.get("rename_on_start", True)))
    except Exception:
        return AppConfig()


def save_config(cfg):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(
            {"server": asdict(cfg.server),
             "mappings": {k: asdict(v) for k, v in cfg.mappings.items()},
             "rename_on_start": cfg.rename_on_start},
            indent=2),
        "utf-8")


class ApiClient:
    def __init__(self, server):
        self.session = requests.Session()
        self.update_server(server)

    def update_server(self, s):
        self.server = s
        self.base = s.api_url.rstrip("/")
        self.session.headers.clear()
        self.session.headers.update({
            "content-type": "application/json",
            "user-agent": f"{APP_NAME}/{APP_VERSION}",
        })
        if s.token and s.token != BRIDGE_TOKEN:
            self.session.headers["Authorization"] = f"Bearer {s.token}"

    def get(self, path, timeout=10):
        r = self.session.get(self.base + path, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def post(self, path, data, timeout=10):
        r = self.session.post(self.base + path, json=data, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def health(self):
        try:
            r = self.session.get(self.base + "/api/health", timeout=8)
            return r.ok, f"HTTP {r.status_code}: {r.text[:300]}"
        except Exception as e:
            return False, str(e)

    def auth_check(self):
        try:
            r = self.session.get(self.base + "/api/queue", timeout=8)
            return r.ok, ("autenticado" if r.ok else f"HTTP {r.status_code}: {r.text[:200]}")
        except Exception as e:
            return False, str(e)


def enum_wow_windows():
    if not HAS_WIN32:
        return []
    out = []
    fg = win32gui.GetForegroundWindow()

    def callback(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd).strip()
        if not title:
            return
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            exe = psutil.Process(pid).exe()
            name = Path(exe).name.lower()
        except Exception:
            pid = 0
            exe = ""
            name = ""
        by_exe = name in ("wow.exe", "wowclassic.exe")
        by_title = title.lower() == "world of warcraft" or bool(re.fullmatch(r"wow\d+", title.lower()))
        if by_exe or (not exe and by_title):
            base = Path(exe).parent if exe else Path()
            out.append(DetectedWindow(
                hwnd, pid, title, exe,
                base / "Logs" / "WoWChatLog.txt",
                base / "Logs" / "WoWCombatLog.txt",
                hwnd == fg,
            ))
    win32gui.EnumWindows(callback, None)
    return sorted(out, key=lambda w: (w.pid, w.hwnd))


def assign_slots(windows):
    used = {int(m.group(1)) for w in windows if (m := re.fullmatch(r"wow(\d+)", w.title.lower()))}
    for w in windows:
        m = re.fullmatch(r"wow(\d+)", w.title.lower())
        if m:
            w.slot = int(m.group(1))
            continue
        n = 1
        while n in used:
            n += 1
        w.slot = n
        used.add(n)


def rename_window(w):
    if HAS_WIN32:
        win32gui.SetWindowText(w.hwnd, f"wow{w.slot}")
        w.title = f"wow{w.slot}"


def focus(hwnd):
    if HAS_WIN32:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)


VK = {
    **{str(i): 0x30 + i for i in range(10)},
    **{chr(65 + i): 65 + i for i in range(26)},
    **{f"F{i}": 0x6F + i for i in range(1, 13)},
    **{f"NUMPAD{i}": 0x60 + i for i in range(10)},
    "SPACE": 0x20, "ENTER": 0x0D, "TAB": 9, "ESC": 0x1B,
    "SHIFT": 0x10, "CTRL": 0x11, "ALT": 0x12,
    "-": 0xBD, "=": 0xBB, "[": 0xDB, "]": 0xDD, "`": 0xC0,
}


def post_key(hwnd, key):
    if not HAS_WIN32:
        return
    vk = VK.get(key.upper())
    if not vk:
        return
    scan = win32api.MapVirtualKey(vk, 0)
    win32gui.PostMessage(hwnd, 0x100, vk, (scan << 16) | 1)
    win32gui.PostMessage(hwnd, 0x101, vk, (scan << 16) | 1 | (1 << 30) | (1 << 31))


class GseSpammer:
    def __init__(self, ch, hwnd, key, interval):
        self.character = ch
        self.hwnd = hwnd
        self.key = key
        self.interval = max(50, min(2000, int(interval)))
        self.stop_event = threading.Event()
        self.pause = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()

    def update(self, key, interval):
        self.key = key
        self.interval = max(50, min(2000, int(interval)))

    def run(self):
        while not self.stop_event.is_set():
            if not self.pause.is_set():
                post_key(self.hwnd, self.key)
            self.stop_event.wait(self.interval / 1000)


def _ocr_text(image: Image.Image) -> str:
    """OCR an image using winocr (Windows native OCR). Returns text or empty string."""
    if not HAS_WINOCR or not HAS_PIL:
        return ""
    try:
        # Try sync version first (no event loop needed)
        result = winocr.recognize_pil_sync(image)
        return result.get("text", "") if isinstance(result, dict) else getattr(result, "text", "")
    except Exception:
        try:
            # Fallback: async version in new event loop
            async def _async():
                return await winocr.recognize_pil(image, "en")
            result = asyncio.run(_async())
            return getattr(result, "text", "") if hasattr(result, "text") else str(result)
        except Exception:
            return ""


class BridgeEngine:
    def __init__(self, api, chars, log, status):
        self.api = api
        self.chars = chars
        self.log = log
        self.status = status
        self.stop_event = threading.Event()
        self.controls = DEFAULT_CONTROLS.copy()
        self.spammers = {}
        self.lock = threading.Lock()
        self.send_lock = threading.Lock()
        self._ocr_failures = {}
        self._voice_listener = None

    def start(self):
        logs = {str(c.window.chat_log): c.window.chat_log for c in self.chars}
        for path in logs.values():
            if path.exists() or True:  # always start, it waits
                threading.Thread(target=self.tail, args=(path, "chatlog"), daemon=True).start()
        combat_logs = {str(c.window.combat_log): c.window.combat_log for c in self.chars}
        for path in combat_logs.values():
            if path.exists() or True:
                threading.Thread(target=self.tail, args=(path, "combatlog"), daemon=True).start()
        for fn in (self.outgoing, self.scanner, self.control_sync, self.gse_sync):
            threading.Thread(target=fn, daemon=True).start()
        self.log(f"Bridge iniciado para {len(self.chars)} personagem(ns).")

    def stop(self):
        self.stop_event.set()
        with self.lock:
            for s in self.spammers.values():
                s.stop()
            self.spammers.clear()

    def find(self, name):
        return next((c for c in self.chars if c.character.lower() == name.lower()), None)

    def _ingest_one(self, character, player, body):
        ext = f"ingest-{time.time_ns()}-{hash(body)}"
        try:
            self.api.post("/api/ingest", {
                "messages": [{"externalId": ext, "character": character, "player": player, "body": body}]
            })
        except Exception as e:
            self.log(f"Falha ingest: {e}")

    def tail(self, path: Path, mode: str):
        # mode: "chatlog" or "combatlog"
        while not self.stop_event.is_set() and not path.exists():
            self.log(f"Aguardando {path.name} — digite /{'combatlog' if mode == 'combatlog' else 'chatlog'} no jogo.")
            self.stop_event.wait(10)
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                f.seek(0, 2)
                while not self.stop_event.is_set():
                    line = f.readline()
                    if not line:
                        self.stop_event.wait(0.15)
                        continue

                    if mode == "chatlog":
                        if not self.controls["bridgeReaderEnabled"]:
                            continue
                        clean = TIMESTAMP_RE.sub("", line.strip())
                        m = ADDON_RE.search(clean)
                        if m:
                            own, sender, body = (x.strip() for x in m.groups())
                            self._ingest_one(own, sender, body)
                    elif mode == "combatlog":
                        if not self.controls["combatRelayEnabled"]:
                            continue
                        # Parse combatlog whispers: CHAT_MSG_WHISPER format
                        m = COMBAT_WHISPER_RE.search(line)
                        if m:
                            player = m.group(2).strip()
                            body = m.group(3).strip()
                            # Find which character received this — check all chars
                            for c in self.chars:
                                self._ingest_one(c.character, player, body)
        except Exception as e:
            self.log(f"Erro no {mode} {path}: {e}")

    def outgoing(self):
        while not self.stop_event.is_set():
            try:
                for msg in self.api.get("/api/queue").get("messages", []):
                    char = self.find(msg["character"])
                    if not char:
                        self.log(f"Mensagem #{msg['id']} aguardando janela {msg['character']}...")
                        continue
                    spam = self.spammers.get(char.character)
                    if spam:
                        spam.pause.set()
                    try:
                        with self.send_lock:
                            focus(char.window.hwnd)
                            time.sleep(self.controls["whisperFocusDelayMs"] / 1000)
                            if not keyboard:
                                raise RuntimeError("pydirectinput não instalado")
                            # Open chat
                            keyboard.press("enter")
                            time.sleep(self.controls["whisperChatOpenDelayMs"] / 1000)
                            # Type command
                            keyboard.write(
                                f"/w {msg['player']} {msg['body']}",
                                interval=self.controls["whisperKeystrokeDelayMs"] / 1000,
                            )
                            time.sleep(self.controls["whisperChatSendDelayMs"] / 1000)
                            keyboard.press("enter")
                            # Optionally close chat
                            if self.controls.get("whisperCloseChatEnabled"):
                                time.sleep(self.controls["whisperChatCloseDelayMs"] / 1000)
                                keyboard.press("esc")
                            time.sleep(self.controls["whisperAfterSendDelayMs"] / 1000)
                        self.api.post(f"/api/queue/{msg['id']}/ack", {"status": "sent"})
                    except Exception as e:
                        self.api.post(f"/api/queue/{msg['id']}/ack", {"status": "failed", "error": str(e)})
                        self.log(f"Falha envio: {e}")
                    finally:
                        if spam:
                            spam.pause.clear()
            except Exception as e:
                self.log(f"Fila indisponível: {e}")
            self.stop_event.wait(self.controls["queuePollMs"] / 1000)

    def scanner(self):
        while not self.stop_event.is_set():
            current = {w.hwnd: w for w in enum_wow_windows()}
            payload = []
            for c in self.chars:
                w = current.get(c.window.hwnd, c.window)
                realm = c.character.rsplit("-", 1)[1] if "-" in c.character else ""
                payload.append({
                    "hwnd": str(w.hwnd), "pid": str(w.pid), "windowTitle": w.title,
                    "foreground": w.foreground, "character": c.character,
                    "matched": True, "slot": str(w.slot), "realm": realm,
                })
            try:
                self.api.post("/api/status/scan", {"windows": payload})
                self.status(len(payload), len(self.spammers))
            except Exception as e:
                self.log(f"Scan: {e}")
            self.stop_event.wait(5)

    def control_sync(self):
        while not self.stop_event.is_set():
            try:
                self.controls.update(self.api.get("/api/control").get("controls", {}))
            except Exception:
                pass
            if not self.controls["gseMasterEnabled"]:
                with self.lock:
                    for s in self.spammers.values():
                        s.stop()
                    self.spammers.clear()
            self.stop_event.wait(2)

    def gse_sync(self):
        while not self.stop_event.is_set():
            if self.controls["gseMasterEnabled"]:
                try:
                    desired = {
                        x["character"]: x
                        for x in self.api.get("/api/gse").get("states", [])
                        if x.get("running") in (True, "yes")
                    }
                    with self.lock:
                        for name in list(self.spammers):
                            if name not in desired:
                                self.spammers.pop(name).stop()
                        for name, row in desired.items():
                            c = self.find(name)
                            if not c:
                                continue
                            if name in self.spammers:
                                self.spammers[name].update(row["keybind"], row["intervalMs"])
                            else:
                                self.spammers[name] = GseSpammer(
                                    name, c.window.hwnd, row["keybind"], row["intervalMs"],
                                )
                                self.spammers[name].start()
                except Exception as e:
                    self.log(f"GSE sync: {e}")
            self.stop_event.wait(1)


class App:
    BG = "#0f172a"
    FG = "#e2e8f0"
    FIELD = "#020617"

    def __init__(self, root):
        self.root = root
        root.title(f"Bakers Whisper v{APP_VERSION}")
        root.geometry("900x680")
        root.configure(bg=self.BG)
        self.cfg = load_config()
        self.api = ApiClient(self.cfg.server)
        self.windows = []
        self.entries = {}
        self.engine = None
        self.logs = queue.Queue()
        self.build()
        self.scan()
        self.flush()
        root.after(10000, self.health)

    def label(self, parent, text, **kw):
        return tk.Label(parent, text=text, bg=kw.pop("bg", self.BG), fg=kw.pop("fg", self.FG), **kw)

    def build(self):
        head = tk.Frame(self.root, bg=self.BG)
        head.pack(fill="x", padx=18, pady=14)
        self.label(head, "🥐  Bakers Whisper", font=("Segoe UI", 18, "bold"), fg="#fbbf24").pack(side="left")
        self.status_label = self.label(head, "● sem conexão", fg="#f87171")
        self.status_label.pack(side="right")

        server = tk.LabelFrame(self.root, text=" Servidor ", bg=self.BG, fg="#fbbf24", padx=10, pady=8)
        server.pack(fill="x", padx=18)
        self.url = tk.Entry(server, width=48, bg=self.FIELD, fg=self.FG, insertbackground="white")
        self.url.insert(0, self.cfg.server.api_url)
        self.url.pack(side="left", padx=4)
        self.token = tk.Entry(server, width=30, show="•", bg=self.FIELD, fg=self.FG, insertbackground="white")
        self.token.insert(0, self.cfg.server.token)
        self.token.pack(side="left", padx=4)
        tk.Button(server, text="💾 Salvar", command=self.save_server).pack(side="left", padx=3)
        tk.Button(server, text="🌐 Testar", command=self.test).pack(side="left")

        self.rows = tk.Frame(self.root, bg=self.BG)
        self.rows.pack(fill="x", padx=18, pady=10)

        controls = tk.Frame(self.root, bg=self.BG)
        controls.pack(fill="x", padx=18)
        self.start_btn = tk.Button(controls, text="▶ Iniciar", bg="#22c55e", command=self.start)
        self.start_btn.pack(side="left", padx=3)
        self.stop_btn = tk.Button(controls, text="■ Parar", bg="#ef4444", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left", padx=3)
        tk.Button(controls, text="🔄 Rescan", command=self.scan).pack(side="left", padx=3)
        tk.Button(controls, text="🔤 Renomear", command=self.rename).pack(side="left", padx=3)
        tk.Button(controls, text="💾 Salvar personagens", command=self.save_chars).pack(side="left", padx=3)
        tk.Button(controls, text="Abrir Painel", command=lambda: webbrowser.open(self.url.get())).pack(side="right")
        self.rename_var = tk.BooleanVar(value=self.cfg.rename_on_start)
        tk.Checkbutton(controls, text="Renomear ao iniciar", variable=self.rename_var, bg=self.BG, fg=self.FG, selectcolor=self.FIELD).pack(side="right")

        self.logbox = scrolledtext.ScrolledText(self.root, bg=self.FIELD, fg=self.FG, font=("Consolas", 9))
        self.logbox.pack(fill="both", expand=True, padx=18, pady=12)

    def scan(self):
        self.windows = enum_wow_windows()
        assign_slots(self.windows)
        for w in self.rows.winfo_children():
            w.destroy()
        for col, text in enumerate(("Slot", "Título", "Personagem-Reino", "Log")):
            self.label(self.rows, text, font=("Segoe UI", 9, "bold")).grid(row=0, column=col, sticky="w", padx=5)
        self.entries = {}
        for i, w in enumerate(self.windows, 1):
            self.label(self.rows, f"wow{w.slot}", fg="#fbbf24").grid(row=i, column=0, padx=5)
            self.label(self.rows, w.title[:25]).grid(row=i, column=1, padx=5)
            e = tk.Entry(self.rows, width=35, bg=self.FIELD, fg=self.FG, insertbackground="white")
            e.insert(0, self.cfg.mappings.get(f"slot:{w.slot}", SavedMapping()).character)
            e.grid(row=i, column=2, padx=5, pady=2)
            self.entries[w.hwnd] = e
            log_status = "OK" if w.chat_log.exists() else "aguardando"
            self.label(self.rows, log_status, fg="#34d399" if w.chat_log.exists() else "#f59e0b").grid(row=i, column=3)
        self.log(f"Detectadas {len(self.windows)} janela(s).")

    def save_chars(self):
        maps = {}
        for w in self.windows:
            name = self.entries[w.hwnd].get().strip()
            if name:
                maps[f"slot:{w.slot}"] = SavedMapping(w.exe_path, w.slot, name)
        self.cfg.mappings = maps
        self.cfg.rename_on_start = self.rename_var.get()
        save_config(self.cfg)
        self.log(f"Salvos {len(maps)} personagem(ns).")
        return maps

    def rename(self):
        for w in self.windows:
            rename_window(w)
        self.log("Janelas renomeadas para wowN.")

    def save_server(self):
        if not self.url.get().startswith("http"):
            messagebox.showerror(APP_NAME, "URL deve começar com http")
            return
        self.cfg.server = ServerSettings(self.url.get().strip(), self.token.get().strip())
        self.api.update_server(self.cfg.server)
        save_config(self.cfg)
        self.test()

    def test(self):
        threading.Thread(target=lambda: self.log(
            "Servidor: " + self.api.health()[1] + " | Auth: " + self.api.auth_check()[1]
        ), daemon=True).start()

    def health(self):
        def work():
            ok, _ = self.api.health()
            auth, _ = self.api.auth_check()
            self.root.after(0, lambda: self.status_label.config(
                text="● conectado" if ok and auth else "● sem conexão",
                fg="#34d399" if ok and auth else "#f87171",
            ))
        threading.Thread(target=work, daemon=True).start()
        self.root.after(10000, self.health)

    def start(self):
        maps = self.save_chars()
        if self.rename_var.get():
            self.rename()
        chars = [
            RuntimeCharacter(maps[f"slot:{w.slot}"].character, w)
            for w in self.windows
            if f"slot:{w.slot}" in maps
        ]
        if not chars:
            messagebox.showwarning(APP_NAME, "Preencha pelo menos um Personagem-Reino.")
            return
        if any("-" not in c.character for c in chars) and not messagebox.askyesno(
            APP_NAME, "Alguns nomes não têm reino. Continuar?"
        ):
            return
        self.engine = BridgeEngine(
            self.api, chars, self.log,
            lambda n, g: self.root.after(0, lambda: self.status_label.config(
                text=f"● {n} mapeadas · GSE {g}", fg="#34d399"
            )),
        )
        self.engine.start()
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")

    def stop(self):
        if self.engine:
            self.engine.stop()
            self.engine = None
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.log("Bridge parado.")

    def log(self, text):
        self.logs.put(f"[{time.strftime('%H:%M:%S')}] {text}")

    def flush(self):
        try:
            while True:
                self.logbox.insert("end", self.logs.get_nowait() + "\n")
                self.logbox.see("end")
        except queue.Empty:
            pass
        self.root.after(200, self.flush)


def main():
    root = tk.Tk()
    app = App(root)
    root.protocol("WM_DELETE_WINDOW", lambda: (app.stop(), root.destroy()))
    root.mainloop()


if __name__ == "__main__":
    main()
