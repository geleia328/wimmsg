"use client";
import { useCallback, useEffect, useState } from "react";

type Win = {
  id: number;
  character: string | null;
  windowTitle: string | null;
  pid: string | null;
  hwnd: string | null;
  foreground: string | null;
  matched: string | null;
  slot: string | null;
  realm: string | null;
  lastSeen: string;
};

export default function AccountsView() {
  const [windows, setWindows] = useState<Win[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) setWindows(j.windows || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contas / Janelas</h1>
          <p className="mt-1 text-sm text-slate-400">
            Janelas de WoW detectadas pelo bridge no seu PC.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
          disabled={loading}
        >
          {loading ? "Atualizando..." : "🔄 Atualizar"}
        </button>
      </div>

      <div className="scroll-x rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Slot</th>
              <th className="px-3 py-2">Personagem</th>
              <th className="px-3 py-2">Realm</th>
              <th className="px-3 py-2">Título da janela</th>
              <th className="px-3 py-2">PID</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Ativa</th>
              <th className="px-3 py-2">Visto</th>
            </tr>
          </thead>
          <tbody>
            {windows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Nenhuma janela reportada ainda. Rode o bridge no seu PC.
                </td>
              </tr>
            )}
            {windows.map((w) => (
              <tr key={w.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono text-emerald-400">{w.slot || "-"}</td>
                <td className="px-3 py-2 font-medium">{w.character || "-"}</td>
                <td className="px-3 py-2 text-slate-400">{w.realm || "-"}</td>
                <td className="px-3 py-2 text-slate-400">{w.windowTitle || "-"}</td>
                <td className="px-3 py-2 font-mono text-slate-500">{w.pid || "-"}</td>
                <td className="px-3 py-2">
                  {w.matched === "yes" ? (
                    <span className="rounded bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">sim</span>
                  ) : (
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-500">não</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {w.foreground === "yes" ? (
                    <span className="rounded bg-sky-900/50 px-2 py-0.5 text-xs text-sky-300">ativa</span>
                  ) : (
                    <span className="text-slate-500">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {new Date(w.lastSeen).toLocaleTimeString("pt-BR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
