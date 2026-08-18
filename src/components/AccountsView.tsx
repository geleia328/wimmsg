"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ClientWindow = {
  id: number;
  character: string;
  windowTitle: string;
  pid: string;
  hwnd: string;
  slot: string;
  realm: string;
  foreground: boolean;
  matched: boolean;
  online: boolean;
  lastSeen: string;
  secondsAgo: number;
};

const POLL_MS = 2000;

export function AccountsView() {
  const [windows, setWindows] = useState<ClientWindow[]>([]);
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      const data = (await r.json()) as { windows: ClientWindow[] };
      setWindows(data.windows ?? []);
      setBridgeUp(true);
    } catch {
      setBridgeUp(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const online = useMemo(() => windows.filter((w) => w.online), [windows]);
  const offline = useMemo(() => windows.filter((w) => !w.online), [windows]);
  const unmapped = useMemo(
    () => windows.filter((w) => !w.matched),
    [windows],
  );

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 font-black text-slate-900 shadow sm:h-9 sm:w-9">
            📡
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg">
              Varredura de contas WoW
            </h1>
            <p className="truncate text-[11px] text-slate-400 sm:text-xs">
              Detecta em tempo real quais janelas do WoW estão abertas no seu PC
            </p>
          </div>
        </div>
        <nav className="order-last -mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 text-xs md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0 md:pb-0">
          <Link
            href="/"
            className="whitespace-nowrap rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800 md:px-3"
          >
            ← Chat
          </Link>
          <Link
            href="/gse"
            className="whitespace-nowrap rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2.5 py-1 text-fuchsia-300 hover:bg-fuchsia-500/20 md:px-3"
          >
            ⚙ GSE
          </Link>
          <Link
            href="/setup"
            className="whitespace-nowrap rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800 md:px-3"
          >
            Setup
          </Link>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
          <StatCard label="Total detectadas" value={windows.length} tone="slate" />
          <StatCard label="Online agora" value={online.length} tone="emerald" />
          <StatCard label="Offline" value={offline.length} tone="rose" />
          <StatCard
            label="Não mapeadas"
            value={unmapped.length}
            tone={unmapped.length > 0 ? "amber" : "slate"}
          />
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeUp === null
                ? "bg-slate-500"
                : bridgeUp
                  ? "bg-emerald-400"
                  : "bg-rose-500"
            }`}
          />
          <span className="text-slate-400">
            {bridgeUp === null
              ? "conectando..."
              : bridgeUp
                ? `Atualizando a cada ${POLL_MS / 1000}s`
                : "sem conexão com a API"}
          </span>
        </div>

        {/* Table (scrolls horizontally on small screens) */}
        <div className="relative mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          {/* Scroll hint on mobile */}
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
            <tbody>
              {loading && windows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Buscando janelas...
                  </td>
                </tr>
              )}
              {!loading && windows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Nenhuma janela do WoW detectada. Abra o Bakers Whisper no
                    seu PC e clique em ▶ Iniciar (
                    <Link href="/download" className="text-amber-400 underline">
                      baixar
                    </Link>
                    ).
                  </td>
                </tr>
              )}
              {windows.map((w) => (
                <tr
                  key={w.id}
                  className={`border-t border-slate-800/60 ${w.foreground ? "bg-amber-500/5" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${w.online ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-500/60" : "bg-slate-600"}`}
                      />
                      <span
                        className={`text-xs font-medium ${w.online ? "text-emerald-300" : "text-slate-500"}`}
                      >
                        {w.online ? "ONLINE" : "OFFLINE"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {w.slot ? (
                      <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
                        wow{w.slot}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {w.matched && w.character ? (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-300">
                        {w.character}
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                        não mapeado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {w.realm ? (
                      <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-xs text-sky-300">
                        {w.realm}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {w.windowTitle}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {w.pid || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {w.foreground ? (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                        em foco
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {w.secondsAgo === 0 ? "agora" : `há ${w.secondsAgo}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {unmapped.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <b>{unmapped.length}</b> janela(s) do WoW aberta(s) sem
            mapeamento. Para permitir envio de mensagens nelas, adicione um
            bloco <code>[character:Nome-Reino]</code> no <code>config.ini</code>{" "}
            do bridge com o mesmo <code>window_title</code> mostrado acima.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "rose" | "amber";
}) {
  const tones: Record<typeof tone, string> = {
    slate: "border-slate-700 bg-slate-900/60 text-slate-100",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  };
  return (
    <div className={`rounded-lg border p-3 sm:rounded-xl sm:p-4 ${tones[tone]}`}>
      <div className="text-xl font-bold sm:text-3xl">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-80 sm:mt-1 sm:text-xs">
        {label}
      </div>
    </div>
  );
}
