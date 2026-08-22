"use client";

import { useCallback, useEffect, useState } from "react";

type WindowStatus = {
  id: number;
  character: string;
  windowTitle: string;
  pid: string;
  hwnd: string;
  foreground: boolean;
  matched: boolean;
  slot: string;
  realm: string;
  lastSeen: string;
  online: boolean;
  onlineByScan?: boolean;
  onlineByActivity?: boolean;
  secondsAgo: number;
  secondsSinceIncoming?: number | null;
};

export function AccountsView() {
  const [windows, setWindows] = useState<WindowStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = (await res.json()) as { windows: WindowStatus[] };
      setWindows(data.windows ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const rescan = async () => {
    await fetch("/api/bridge-sim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deliver" }),
    });
    void load();
  };

  const online = windows.filter((w) => w.online);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Janelas / contas</h1>
          <p className="text-sm text-slate-400">
            Varredura ao vivo das janelas do WoW reportadas pelo bridge.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void rescan()}
          className="ml-auto rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/10"
        >
          🔄 reescanear agora
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Janelas vistas", value: windows.length },
          { label: "Online", value: online.length },
          { label: "Com nome reconhecido", value: windows.filter((w) => w.matched).length },
          { label: "Em foco", value: windows.filter((w) => w.foreground).length },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">carregando…</p>
      ) : windows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
          Nenhuma janela reportada. No preview, ative o{" "}
          <b>modo demo</b> na tela de conversas (ele registra janelas simuladas).
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {windows.map((w) => (
            <div
              key={w.id}
              className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${w.online ? "bg-emerald-400" : "bg-slate-600"}`}
                />
                <p className="font-medium">
                  {w.character ? w.character : "(sem personagem)"}
                </p>
                {w.foreground ? (
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                    foco
                  </span>
                ) : null}
                <span className="ml-auto text-[11px] text-slate-500">
                  {w.online ? "agora" : `${w.secondsAgo}s`}
                </span>
              </div>
              <p className="mt-2 truncate text-xs text-slate-400" title={w.windowTitle}>
                {w.windowTitle}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                slot {w.slot || "-"} · realm {w.realm || "-"} · pid {w.pid || "-"} ·
                hwnd {w.hwnd}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {w.onlineByScan
                  ? `🟢 scan vivo (${w.secondsAgo}s atrás)`
                  : w.onlineByActivity
                    ? `🟡 ativo: último whisper há ${w.secondsSinceIncoming ?? "—"}s`
                    : `⚪ offline (último scan ${w.secondsAgo}s atrás)`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
