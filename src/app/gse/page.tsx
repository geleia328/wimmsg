"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type GseRow = {
  character: string;
  running: boolean;
  keybind: string;
  intervalMs: number;
  updatedAt: string;
};

export default function GsePage() {
  const [states, setStates] = useState<GseRow[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/gse", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { states: GseRow[] };
          setStates(data.states);
        }
      } catch {
        // ignore
      }
    };
    void load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, []);

  const toggle = async (character: string, running: boolean) => {
    await fetch(`/api/gse/${encodeURIComponent(character)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ running: !running }),
    });
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">⚙ GSE Macro Spam</h1>
      </header>
      <div className="mx-auto max-w-4xl p-4">
        {states.length === 0 ? (
          <p className="text-slate-500">Nenhum personagem com estado GSE registrado.</p>
        ) : (
          <div className="space-y-3">
            {states.map((s) => (
              <div key={s.character} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div>
                  <div className="font-bold">{s.character}</div>
                  <div className="text-xs text-slate-400">
                    Keybind: {s.keybind} · Intervalo: {s.intervalMs}ms
                  </div>
                </div>
                <button
                  onClick={() => toggle(s.character, s.running)}
                  className={`rounded px-4 py-2 text-sm font-bold ${s.running ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
                >
                  {s.running ? "Parar" : "Iniciar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
