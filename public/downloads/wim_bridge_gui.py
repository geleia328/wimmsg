#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wim_bridge_gui.py — Bakers Whisper bridge com GUI Tkinter.

Wrapper em cima de wim_bridge.py: instancia Bridge em thread, expõe status
e log em uma janela. Mantém a mesma sequência de envio 1..7 acordada com o
usuário.
"""
from __future__ import annotations

import os
import sys
import threading
import queue
import time
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

try:
    import wim_bridge as core  # type: ignore
except Exception as e:
    print("Não consegui importar wim_bridge.py:", e, file=sys.stderr)
    raise


class GuiLog:
    def __init__(self):
        self.q: "queue.Queue[str]" = queue.Queue()

    def write(self, s: str):
        if not s:
            return
        for line in s.rstrip("\n").splitlines():
            self.q.put(line)

    def flush(self):
        pass

    def drain(self):
        out = []
        while True:
            try:
                out.append(self.q.get_nowait())
            except queue.Empty:
                break
        return out


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("Bakers Whisper — Bridge 2.5")
        root.geometry("900x560")
        self.cfg_path = os.path.join(HERE, "config.ini")
        self.cfg = core.load_config(self.cfg_path)
        self.bridge_thread: threading.Thread | None = None
        self.bridge: core.Bridge | None = None
        self.log = GuiLog()
        self._build()
        self._redirect_stdio()
        self._poll_log()

    def _build(self):
        top = ttk.Frame(self.root, padding=8)
        top.pack(fill=tk.X)
        ttk.Label(top, text="Site URL:").grid(row=0, column=0, sticky="w")
        self.var_url = tk.StringVar(value=self.cfg.base_url)
        ttk.Entry(top, textvariable=self.var_url, width=44).grid(row=0, column=1, padx=4, sticky="we")
        ttk.Label(top, text="Token:").grid(row=0, column=2, sticky="w", padx=(10, 0))
        self.var_token = tk.StringVar(value=self.cfg.bridge_token)
        ttk.Entry(top, textvariable=self.var_token, width=24, show="*").grid(row=0, column=3, padx=4, sticky="we")
        ttk.Label(top, text="ChatLog:").grid(row=1, column=0, sticky="w")
        self.var_log = tk.StringVar(value=self.cfg.chatlog_path or (core.find_default_chatlog() or ""))
        ttk.Entry(top, textvariable=self.var_log, width=60).grid(row=1, column=1, columnspan=2, padx=4, sticky="we", pady=(4, 0))
        ttk.Button(top, text="Procurar…", command=self._pick_log).grid(row=1, column=3, padx=4, pady=(4, 0), sticky="we")

        # STT row
        self.var_stt = tk.BooleanVar(value=self.cfg.stt_enabled)
        ttk.Checkbutton(top, text="🔊 Leitura por TTS→STT (recomendado)", variable=self.var_stt).grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 0))
        ttk.Label(top, text="Modelo Whisper:").grid(row=2, column=2, sticky="e", pady=(6, 0))
        self.var_stt_model = tk.StringVar(value=self.cfg.stt_model)
        ttk.Combobox(top, textvariable=self.var_stt_model, values=[
            "tiny.en", "tiny", "small.en", "small", "medium.en", "medium",
        ], width=12).grid(row=2, column=3, padx=4, sticky="we", pady=(6, 0))

        top.grid_columnconfigure(1, weight=1)
        top.grid_columnconfigure(3, weight=1)

        btns = ttk.Frame(self.root, padding=(8, 0, 8, 8))
        btns.pack(fill=tk.X)
        self.btn_start = ttk.Button(btns, text="▶ Iniciar bridge", command=self._start)
        self.btn_start.pack(side=tk.LEFT)
        self.btn_stop = ttk.Button(btns, text="⏹ Parar", command=self._stop, state=tk.DISABLED)
        self.btn_stop.pack(side=tk.LEFT, padx=6)
        ttk.Button(btns, text="💾 Salvar config", command=self._save).pack(side=tk.LEFT, padx=6)
        self.lbl_status = ttk.Label(btns, text="parado")
        self.lbl_status.pack(side=tk.RIGHT)

        self.txt = tk.Text(self.root, height=20, wrap="none", bg="#0f172a", fg="#e2e8f0", insertbackground="#e2e8f0")
        self.txt.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))
        sb = ttk.Scrollbar(self.txt, orient="vertical", command=self.txt.yview)
        self.txt.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)

    def _pick_log(self):
        p = filedialog.askopenfilename(title="Selecione WoWChatLog.txt", filetypes=[("Log", "*.txt"), ("Todos", "*.*")])
        if p:
            self.var_log.set(p)

    def _redirect_stdio(self):
        sys.stdout = self.log  # type: ignore
        sys.stderr = self.log  # type: ignore

    def _poll_log(self):
        for line in self.log.drain():
            self.txt.insert(tk.END, line + "\n")
            self.txt.see(tk.END)
        self.root.after(200, self._poll_log)

    def _save(self):
        import configparser
        cp = configparser.ConfigParser()
        if os.path.exists(self.cfg_path):
            cp.read(self.cfg_path, encoding="utf-8")
        for sec in ("server", "bridge", "stt"):
            if not cp.has_section(sec):
                cp.add_section(sec)
        cp.set("server", "base_url", self.var_url.get().strip())
        cp.set("server", "bridge_token", self.var_token.get().strip())
        cp.set("bridge", "chatlog_path", self.var_log.get().strip())
        cp.set("stt", "enabled", "yes" if self.var_stt.get() else "no")
        cp.set("stt", "model", self.var_stt_model.get().strip() or "small")
        with open(self.cfg_path, "w", encoding="utf-8") as f:
            cp.write(f)
        messagebox.showinfo("Bakers Whisper", "Configuração salva em config.ini")

    def _start(self):
        if self.bridge_thread and self.bridge_thread.is_alive():
            return
        self.cfg.base_url = self.var_url.get().strip() or self.cfg.base_url
        self.cfg.bridge_token = self.var_token.get().strip()
        self.cfg.chatlog_path = self.var_log.get().strip()
        self.cfg.stt_enabled = bool(self.var_stt.get())
        self.cfg.stt_model = self.var_stt_model.get().strip() or self.cfg.stt_model
        self.bridge = core.Bridge(self.cfg)
        self.bridge_thread = threading.Thread(target=self.bridge.start, daemon=True)
        self.bridge_thread.start()
        self.btn_start.configure(state=tk.DISABLED)
        self.btn_stop.configure(state=tk.NORMAL)
        stt_flag = " · STT ON" if self.cfg.stt_enabled else ""
        self.lbl_status.configure(text=f"rodando · {self.cfg.base_url}{stt_flag}")

    def _stop(self):
        if self.bridge:
            self.bridge.stop_event.set()
        self.btn_start.configure(state=tk.NORMAL)
        self.btn_stop.configure(state=tk.DISABLED)
        self.lbl_status.configure(text="parado")


def main():
    root = tk.Tk()
    try:
        style = ttk.Style()
        if "clam" in style.theme_names():
            style.theme_use("clam")
    except Exception:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
