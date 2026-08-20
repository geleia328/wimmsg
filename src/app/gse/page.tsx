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

  const [newChar, setNewChar] = useState("");
  const [newKeybind, setNewKeybind] = useState("1");
  const [newInterval, setNewInterval] = useState("100");

  const addOrUpdate = async () => {
    if (!newChar.trim()) return;
    await fetch(`/api/gse/${encodeURIComponent(newChar.trim())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keybind: newKeybind, intervalMs: Number(newInterval) }),
    });
    setNewChar("");
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">⚙ GSE Macro Spam</h1>
      </header>
      <div className="mx-auto max-w-4xl p-4 space-y-6">
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <h2 className="mb-3 font-bold text-amber-400">Adicionar / Editar Personagem</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs mb-1 text-slate-400">Personagem</label>
              <input value={newChar} onChange={e => setNewChar(e.target.value)} placeholder="Nome-Reino" className="rounded bg-slate-700 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs mb-1 text-slate-400">Tecla (ex: 1, F1)</label>
              <input value={newKeybind} onChange={e => setNewKeybind(e.target.value)} className="w-20 rounded bg-slate-700 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs mb-1 text-slate-400">Intervalo (ms)</label>
              <input value={newInterval} onChange={e => setNewInterval(e.target.value)} type="number" className="w-24 rounded bg-slate-700 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <button onClick={addOrUpdate} className="rounded bg-amber-600 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-500">
              Salvar
            </button>
          </div>
        </div>

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
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setNewChar(s.character);
                      setNewKeybind(s.keybind);
                      setNewInterval(String(s.intervalMs));
                    }}
                    className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggle(s.character, s.running)}
                    className={`rounded px-4 py-2 text-sm font-bold ${s.running ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
                  >
                    {s.running ? "Parar" : "Iniciar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
