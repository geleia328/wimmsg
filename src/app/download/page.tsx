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
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/5 p-6">
          <h2 className="mb-2 text-xl font-bold text-emerald-300">📥 BakersWhisper para Windows</h2>
          <p className="mb-4 text-sm text-slate-300">
            Aplicativo que conecta as janelas do WoW ao chat. Baixe, abra e
            configure a URL do site e o token dentro do programa.
          </p>
          <a
            href="/api/download/BakersWhisper.exe"
            className="inline-block rounded bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 shadow hover:bg-emerald-400"
          >
            ⬇ Baixar BakersWhisper.exe
          </a>
          <p className="mt-3 text-xs text-slate-500">
            Windows 10 ou 11. O Windows Defender pode pedir confirmação porque
            o aplicativo ainda não possui assinatura digital.
          </p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-2 text-lg font-bold text-amber-400">WIMBridge Addon (WoW)</h2>
          <p className="mb-3 text-sm text-slate-300">
            Addon Lua para World of Warcraft que relays whispers para o bridge Python.
          </p>
          <a
            href="/downloads/WIMBridge.zip"
            className="inline-block rounded bg-amber-600 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-500"
          >
            ⬇ Baixar WIMBridge.zip
          </a>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-2 text-lg font-bold text-amber-400">WIMBridge.lua (avulso)</h2>
          <p className="mb-3 text-sm text-slate-300">
            Arquivo Lua individual caso queira instalar manualmente.
          </p>
          <a
            href="/downloads/WIMBridge.lua"
            className="inline-block rounded bg-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-600"
          >
            ⬇ Baixar WIMBridge.lua
          </a>
        </div>
      </div>
    </div>
  );
}
