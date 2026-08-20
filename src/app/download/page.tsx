"use client";

import Link from "next/link";

export default function DownloadPage() {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">📥 Downloads</h1>
      </header>
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-6">
          <h2 className="mb-2 text-lg font-bold text-sky-400">App Bridge (.exe / .py)</h2>
          <p className="mb-3 text-sm text-slate-300">
            O aplicativo desktop que faz a ponte entre as janelas do WoW e o painel web. 
            Ele captura os whispers e escreve suas respostas.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/downloads/wim_bridge_gui.py"
              className="inline-block rounded bg-sky-600 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-500"
              download
            >
              ⬇ Baixar Script Python (.py)
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            * Nota: Você pode rodar diretamente com o Python instalado via <code>python wim_bridge_gui.py</code> ou compilar para .exe usando <code>pyinstaller --onefile --noconsole wim_bridge_gui.py</code>
          </p>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-2 text-lg font-bold text-amber-400">WIMBridge Addon (WoW)</h2>
          <p className="mb-3 text-sm text-slate-300">
            Addon Lua para World of Warcraft que envia whispers para captura.
          </p>
          <a
            href="/downloads/WIMBridge.zip"
            className="inline-block rounded bg-amber-600 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-500"
          >
            ⬇ Baixar WIMBridge.zip
          </a>
        </div>
      </div>
    </div>
  );
}
