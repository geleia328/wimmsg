"use client";

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";

type Window = {
  character: string;
  windowTitle: string;
  pid: string;
  hwnd: string;
  foreground: string;
  matched: string;
  slot: string;
  realm: string;
  lastSeen: string;
};

export default function AccountsPage() {
  const [windows, setWindows] = useState<Window[]>([]);
  const [stats, setStats] = useState({ total: 0, online: 0, offline: 0, unmapped: 0 });

  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { windows: Window[] };
          setWindows(data.windows);
          const now = new Date();
          const online = data.windows.filter(
            (w) => now.getTime() - new Date(w.lastSeen).getTime() < 15000,
          );
          const offline = data.windows.filter(
            (w) => now.getTime() - new Date(w.lastSeen).getTime() >= 15000,
          );
          const unmapped = online.filter((w) => !w.matched || w.matched === "no");
          setStats({
            total: data.windows.length,
            online: online.length,
            offline: offline.length,
            unmapped: unmapped.length,
          });
        }
      } catch {
        // ignore
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 sm:rounded-xl sm:p-4 text-slate-100">
            <div className="text-xl font-bold sm:text-3xl">{stats.total}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-80 sm:mt-1 sm:text-xs">
              Total detectadas
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 sm:rounded-xl sm:p-4 text-emerald-300">
            <div className="text-xl font-bold sm:text-3xl">{stats.online}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-80 sm:mt-1 sm:text-xs">
              Online agora
            </div>
          </div>
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 sm:rounded-xl sm:p-4 text-rose-300">
            <div className="text-xl font-bold sm:text-3xl">{stats.offline}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-80 sm:mt-1 sm:text-xs">
              Offline
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 sm:rounded-xl sm:p-4 text-slate-100">
            <div className="text-xl font-bold sm:text-3xl">{stats.unmapped}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-80 sm:mt-1 sm:text-xs">
              Não mapeadas
            </div>
          </div>
        </div>

        <div className="relative mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-900/80 to-transparent sm:hidden" />
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="bg-slate-900/60 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Slot</th>
                <th className="px-4 py-3">Personagem</th>
                <th className="px-4 py-3">Servidor</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">PID</th>
                <th className="px-4 py-3">Foreground</th>
                <th className="px-4 py-3">Visto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {windows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Buscando janelas...
                  </td>
                </tr>
              ) : (
                windows.map((w) => {
                  const isOnline =
                    new Date().getTime() - new Date(w.lastSeen).getTime() < 15000;
                  return (
                    <tr key={w.hwnd} className="hover:bg-slate-800/20 transition">
                      <td className="px-4 py-3 text-xs font-bold">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            isOnline ? "bg-emerald-500" : "bg-slate-600"
                          }`}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">{w.slot || "—"}</td>
                      <td className="px-4 py-3 text-sm">{w.character || "—"}</td>
                      <td className="px-4 py-3 text-sm">{w.realm || "—"}</td>
                      <td className="px-4 py-3 truncate text-xs text-slate-400">
                        {w.windowTitle}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {w.pid}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {w.foreground === "yes" ? "✓" : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {Math.round(
                          (new Date().getTime() - new Date(w.lastSeen).getTime()) / 1000,
                        )}
                        s
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
