"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type WindowStatus = {
  character: string;
  windowTitle: string;
  slot: string;
  realm: string;
  online: boolean;
  matched: boolean;
};

type GseRow = {
  character: string;
  running: boolean;
  keybind: string;
  intervalMs: number;
  updatedAt: string;
};

type Controls = {
  bridgeReaderEnabled: boolean;
  gseMasterEnabled: boolean;
  whisperFocusDelayMs: number;
  whisperAfterSendDelayMs: number;
  queuePollMs: number;
};

const POLL_MS = 2000;

export function GseView() {
  const [windows, setWindows] = useState<WindowStatus[]>([]);
  const [states, setStates] = useState<Record<string, GseRow>>({});
  const [controls, setControls] = useState<Controls>({
    bridgeReaderEnabled: true,
    gseMasterEnabled: false,
    whisperFocusDelayMs: 500,
    whisperAfterSendDelayMs: 500,
    queuePollMs: 1500,
  });
  const [delayDraft, setDelayDraft] = useState({
    whisperFocusDelayMs: "500",
    whisperAfterSendDelayMs: "500",
    queuePollMs: "1500",
  });
  const [delayDirty, setDelayDirty] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [w, g, c] = await Promise.all([
        fetch("/api/status", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/gse", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/control", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setWindows((w as { windows: WindowStatus[] }).windows ?? []);
      const map: Record<string, GseRow> = {};
      for (const s of (g as { states: GseRow[] }).states ?? []) {
        map[s.character] = s;
      }
      setStates(map);
      const nextControls = (c as { controls: Controls }).controls;
      setControls(nextControls);
      if (!delayDirty) {
        setDelayDraft({
          whisperFocusDelayMs: String(nextControls.whisperFocusDelayMs),
          whisperAfterSendDelayMs: String(nextControls.whisperAfterSendDelayMs),
          queuePollMs: String(nextControls.queuePollMs),
        });
      }
      setBridgeUp(true);
    } catch {
      setBridgeUp(false);
    }
  }, [delayDirty]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const characters = useMemo(() => {
    // Any character that is either detected as an online window OR that
    // already has a GSE row in the DB.
    const set = new Set<string>();
    for (const w of windows) if (w.character) set.add(w.character);
    for (const c of Object.keys(states)) set.add(c);
    return Array.from(set).sort();
  }, [windows, states]);

  const runningCount = useMemo(
    () => characters.filter((c) => states[c]?.running).length,
    [characters, states],
  );

  const updateOne = useCallback(
    async (character: string, patch: Partial<GseRow>) => {
      setBusy((b) => ({ ...b, [character]: true }));
      try {
        await fetch(`/api/gse/${encodeURIComponent(character)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        await refresh();
      } finally {
        setBusy((b) => ({ ...b, [character]: false }));
      }
    },
    [refresh],
  );

  const bulk = useCallback(
    async (action: "startAll" | "stopAll") => {
      await fetch("/api/gse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, characters }),
      });
      await refresh();
    },
    [characters, refresh],
  );

  const updateControls = useCallback(
    async (patch: Partial<Controls>) => {
      const adminToken = localStorage.getItem("bakers-whisper:admin-token") ?? "";
      const res = await fetch("/api/control", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        alert("Abra /settings e informe o token admin antes de alterar controles.");
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const saveDelays = useCallback(async () => {
    const patch = {
      whisperFocusDelayMs: Number(delayDraft.whisperFocusDelayMs),
      whisperAfterSendDelayMs: Number(delayDraft.whisperAfterSendDelayMs),
      queuePollMs: Number(delayDraft.queuePollMs),
    };
    if (
      !Number.isFinite(patch.whisperFocusDelayMs) ||
      !Number.isFinite(patch.whisperAfterSendDelayMs) ||
      !Number.isFinite(patch.queuePollMs)
    ) {
      alert("Preencha todos os delays com números válidos.");
      return;
    }
    await updateControls(patch);
    setDelayDirty(false);
  }, [delayDraft, updateControls]);

  return (
    <div className="min-h-screen">
      <header className="flex flex-col gap-4 border-b border-slate-800 bg-slate-900/80 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-700 font-black text-white shadow">
            ⚙
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Controle GSE</h1>
            <p className="text-xs text-slate-400">
              Ativa/desativa o macro GSE em cada janela
              {runningCount > 0 && (
                <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
                  {runningCount} rodando
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeUp ? "bg-emerald-400" : "bg-rose-500"
            }`}
          />
          <span className="text-slate-400">
            {bridgeUp ? "conectado" : "sem conexão"}
          </span>
          <Link
            href="/"
            className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800 lg:ml-4"
          >
            ← Chat
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Global controls */}
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-slate-500">
            Controle global
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-100">Leitor de janelas/whispers</div>
                  <div className="text-xs text-slate-500">
                    Mantém scan de contas + leitura do chat log ativa.
                  </div>
                </div>
                <button
                  onClick={() =>
                    void updateControls({
                      bridgeReaderEnabled: !controls.bridgeReaderEnabled,
                    })
                  }
                  className={`rounded px-4 py-2 text-xs font-bold ${
                    controls.bridgeReaderEnabled
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {controls.bridgeReaderEnabled ? "LIGADO" : "DESLIGADO"}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-100">Master GSE</div>
                  <div className="text-xs text-slate-500">
                    Se desligado, nenhuma janela recebe clique/tecla GSE.
                  </div>
                </div>
                <button
                  onClick={() =>
                    void updateControls({
                      gseMasterEnabled: !controls.gseMasterEnabled,
                    })
                  }
                  className={`rounded px-4 py-2 text-xs font-bold ${
                    controls.gseMasterEnabled
                      ? "bg-fuchsia-500 text-white"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {controls.gseMasterEnabled ? "GSE ON" : "GSE OFF"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-xs text-slate-400">
              Delay antes de digitar whisper
              <input
                type="number"
                min={100}
                max={5000}
                step={100}
                value={delayDraft.whisperFocusDelayMs}
                onFocus={() => setDelayDirty(true)}
                onChange={(e) => {
                  setDelayDirty(true);
                  setDelayDraft((d) => ({
                    ...d,
                    whisperFocusDelayMs: e.target.value,
                  }));
                }}
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              Delay depois de enviar whisper
              <input
                type="number"
                min={100}
                max={5000}
                step={100}
                value={delayDraft.whisperAfterSendDelayMs}
                onFocus={() => setDelayDirty(true)}
                onChange={(e) => {
                  setDelayDirty(true);
                  setDelayDraft((d) => ({
                    ...d,
                    whisperAfterSendDelayMs: e.target.value,
                  }));
                }}
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              Poll da fila de whisper
              <input
                type="number"
                min={500}
                max={10000}
                step={100}
                value={delayDraft.queuePollMs}
                onFocus={() => setDelayDirty(true)}
                onChange={(e) => {
                  setDelayDirty(true);
                  setDelayDraft((d) => ({ ...d, queuePollMs: e.target.value }));
                }}
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void saveDelays()}
              disabled={!delayDirty}
              className="rounded bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              💾 Salvar delays
            </button>
            {delayDirty ? (
              <span className="text-xs text-amber-300">
                alterações pendentes — clique em Salvar delays
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                delays salvos: {controls.whisperFocusDelayMs}ms /{" "}
                {controls.whisperAfterSendDelayMs}ms / {controls.queuePollMs}ms
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              onClick={() => void bulk("startAll")}
              disabled={characters.length === 0 || !controls.gseMasterEnabled}
              className="w-full rounded-lg bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-40 sm:w-auto"
            >
              ▶ Iniciar TODOS ({characters.length})
            </button>
            <button
              onClick={() => void bulk("stopAll")}
              disabled={characters.length === 0}
              className="w-full rounded-lg bg-rose-500 px-6 py-3 text-sm font-bold text-white shadow hover:bg-rose-400 disabled:opacity-40 sm:w-auto"
            >
              ⏹ Parar TODOS
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            💡 O leitor pode ficar ligado com o GSE desligado. O GSE só roda
            quando <b>Master GSE</b> está ON e o personagem também está marcado
            como rodando.
          </p>
        </div>

        {/* Per-character cards on mobile */}
        <div className="space-y-3 md:hidden">
          {characters.length === 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-500">
              Nenhum personagem detectado. Abra o Bakers Whisper no seu PC e clique em ▶ Iniciar.
            </div>
          )}
          {characters.map((c) => {
            const win = windows.find((w) => w.character === c);
            const state = states[c] ?? {
              character: c,
              running: false,
              keybind: "1",
              intervalMs: 100,
              updatedAt: new Date().toISOString(),
            };
            return (
              <div key={c} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 font-mono text-sm text-emerald-300 break-all">{c}</div>
                  {win?.slot ? (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                      wow{win.slot}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${win?.online ? "bg-emerald-400" : "bg-slate-600"}`} />
                  <span className={win?.online ? "text-emerald-300" : "text-slate-500"}>
                    {win?.online ? "online" : "offline"}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-400">
                    Tecla GSE
                    <input
                      value={state.keybind}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 8);
                        setStates((s) => ({ ...s, [c]: { ...state, keybind: v } }));
                      }}
                      onBlur={(e) => void updateOne(c, { keybind: e.target.value })}
                      placeholder="1"
                      className="mt-1 w-full rounded bg-slate-800 px-2 py-2 text-center font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Intervalo (ms)
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      step={10}
                      value={state.intervalMs}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setStates((s) => ({ ...s, [c]: { ...state, intervalMs: v } }));
                      }}
                      onBlur={(e) => void updateOne(c, { intervalMs: Number(e.target.value) })}
                      className="mt-1 w-full rounded bg-slate-800 px-2 py-2 text-right font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                    />
                  </label>
                </div>
                <button
                  onClick={() => void updateOne(c, { running: !state.running })}
                  disabled={busy[c] || (!controls.gseMasterEnabled && !state.running)}
                  title={!controls.gseMasterEnabled && !state.running ? "Ligue o Master GSE primeiro" : undefined}
                  className={`mt-4 w-full rounded-lg px-4 py-2 text-xs font-bold shadow transition disabled:opacity-40 ${
                    state.running
                      ? "bg-rose-500 text-white hover:bg-rose-400"
                      : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                  }`}
                >
                  {state.running ? "⏹ parar" : "▶ iniciar"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Per-character table on desktop */}
        <div className="hidden overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900/60 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Personagem</th>
                <th className="px-4 py-3">Slot</th>
                <th className="px-4 py-3">Status janela</th>
                <th className="px-4 py-3">Tecla GSE</th>
                <th className="px-4 py-3">Intervalo</th>
                <th className="px-4 py-3">GSE</th>
              </tr>
            </thead>
            <tbody>
              {characters.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nenhum personagem detectado. Abra o Bakers Whisper no seu PC e clique em ▶ Iniciar.
                  </td>
                </tr>
              )}
              {characters.map((c) => {
                const win = windows.find((w) => w.character === c);
                const state = states[c] ?? {
                  character: c,
                  running: false,
                  keybind: "1",
                  intervalMs: 100,
                  updatedAt: new Date().toISOString(),
                };
                return (
                  <tr key={c} className="border-t border-slate-800/60">
                    <td className="px-4 py-3 font-mono text-sm text-emerald-300">{c}</td>
                    <td className="px-4 py-3">
                      {win?.slot ? (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">wow{win.slot}</span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${win?.online ? "bg-emerald-400" : "bg-slate-600"}`} />
                        <span className={`text-xs ${win?.online ? "text-emerald-300" : "text-slate-500"}`}>
                          {win?.online ? "online" : "offline"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={state.keybind}
                        onChange={(e) => {
                          const v = e.target.value.slice(0, 8);
                          setStates((s) => ({ ...s, [c]: { ...state, keybind: v } }));
                        }}
                        onBlur={(e) => void updateOne(c, { keybind: e.target.value })}
                        placeholder="1"
                        className="w-16 rounded bg-slate-800 px-2 py-1 text-center font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={50}
                          max={2000}
                          step={10}
                          value={state.intervalMs}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setStates((s) => ({ ...s, [c]: { ...state, intervalMs: v } }));
                          }}
                          onBlur={(e) => void updateOne(c, { intervalMs: Number(e.target.value) })}
                          className="w-20 rounded bg-slate-800 px-2 py-1 text-right font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                        />
                        <span className="text-xs text-slate-500">ms</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void updateOne(c, { running: !state.running })}
                        disabled={busy[c] || (!controls.gseMasterEnabled && !state.running)}
                        title={!controls.gseMasterEnabled && !state.running ? "Ligue o Master GSE primeiro" : undefined}
                        className={`rounded-lg px-4 py-2 text-xs font-bold shadow transition disabled:opacity-40 ${
                          state.running
                            ? "bg-rose-500 text-white hover:bg-rose-400"
                            : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                        }`}
                      >
                        {state.running ? "⏹ parar" : "▶ iniciar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100">
          <b className="text-amber-300">Como configurar o GSE:</b>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Instale o addon <b>GSE - Advanced Macros</b> no CurseForge/WoWUp
              e crie sua sequência.
            </li>
            <li>
              No WoW, arraste a macro do GSE para a barra de ação e{" "}
              <b>anote em qual tecla ela está</b> (ex. <code>1</code>,{" "}
              <code>F1</code>, <code>NUMPAD1</code>).
            </li>
            <li>
              Configure a mesma tecla no campo <b>&quot;Tecla GSE&quot;</b>{" "}
              acima para cada personagem.
            </li>
            <li>Clique ▶ iniciar. O Python vai spammar essa tecla em background.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
