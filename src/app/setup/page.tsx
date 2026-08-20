"use client";

import Link from "next/link";

export default function SetupPage() {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">🛠 Setup — Python Bridge</h1>
      </header>
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-3 text-xl font-bold text-amber-400">1. Instale o Python 3.10+</h2>
          <p className="text-sm text-slate-300">
            Baixe em <a href="https://python.org" className="text-sky-400 underline" target="_blank" rel="noreferrer">python.org</a>.
            Marque &quot;Add Python to PATH&quot; durante a instalação.
          </p>
        </section>
        <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-3 text-xl font-bold text-amber-400">2. Baixe os arquivos do Bridge</h2>
          <p className="text-sm text-slate-300 mb-3">
            Baixe os arquivos necessários:
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-300 space-y-1">
            <li><code>wim_bridge.py</code></li>
            <li><code>requirements.txt</code></li>
            <li><code>config.example.ini</code></li>
          </ul>
        </section>
        <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-3 text-xl font-bold text-amber-400">3. Instale dependências</h2>
          <pre className="rounded bg-slate-900 p-3 text-sm text-emerald-300">
            pip install -r requirements.txt
          </pre>
        </section>
        <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-3 text-xl font-bold text-amber-400">4. Configure</h2>
          <pre className="rounded bg-slate-900 p-3 text-sm text-emerald-300">
{`cp config.example.ini config.ini
# Edite config.ini com seus personagens
# Adicione um bloco [character:Nome-Reino] para cada janela do WoW`}
          </pre>
        </section>
        <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-3 text-xl font-bold text-amber-400">5. Execute</h2>
          <pre className="rounded bg-slate-900 p-3 text-sm text-emerald-300">
            python wim_bridge.py
          </pre>
        </section>
        <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="mb-3 text-xl font-bold text-amber-400">6. Addon WoW (opcional)</h2>
          <p className="text-sm text-slate-300">
            Copie a pasta <code>WIMBridge</code> para <code>Interface/AddOns/</code> no diretório do WoW.
            O addon exporta whispers via um canal de relay para captura OCR.
          </p>
        </section>
      </div>
    </div>
  );
}
