"use client";

import { useCallback, useEffect, useState } from "react";
import { Layout } from "@/components/Layout";

type Controls = {
  bridgeReaderEnabled: boolean;
  gseMasterEnabled: boolean;
  whisperFocusDelayMs: number;
  whisperAfterSendDelayMs: number;
  whisperChatOpenDelayMs: number;
  whisperKeystrokeDelayMs: number;
  whisperChatSendDelayMs: number;
  whisperCloseChatEnabled: boolean;
  whisperChatCloseDelayMs: number;
  voiceRelayEnabled: boolean;
  combatRelayEnabled: boolean;
  ocrRelayEnabled: boolean;
  wimScreenOcrEnabled: boolean;
  queuePollMs: number;
};

type GseRow = {
  character: string;
  running: boolean;
  keybind: string;
  intervalMs: number;
};

const EMPTY: Controls = {
  bridgeReaderEnabled: true,
  gseMasterEnabled: false,
  whisperFocusDelayMs: 2000,
  whisperAfterSendDelayMs: 1000,
  whisperChatOpenDelayMs: 1000,
  whisperKeystrokeDelayMs: 100,
  whisperChatSendDelayMs: 1000,
  whisperCloseChatEnabled: true,
  whisperChatCloseDelayMs: 500,
  voiceRelayEnabled: true,
  combatRelayEnabled: true,
  ocrRelayEnabled: true,
  wimScreenOcrEnabled: true,
  queuePollMs: 1500,
};

export default function GsePage() {
  const [controls, setControls] = useState<Controls>(EMPTY);
  const [states, setStates] = useState<GseRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cRes, gRes] = await Promise.all([
        fetch("/api/control", { cache: "no-store" }),
        fetch("/api/gse", { cache: "no-store" }),
      ]);
      if (cRes.ok) {
        const d = (await cRes.json()) as { controls: Controls };
        setControls(d.controls);
      }
      if (gRes.ok) {
        const d = (await gRes.json()) as { states: GseRow[] };
        setStates(d.states);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const saveControl = async (patch: Partial<Controls>, label: string) => {
    setSaving(label);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const d = (await res.json()) as { controls: Controls };
        setControls(d.controls);
      }
    } finally {
      setSaving(null);
    }
  };

  const toggleOne = async (char: string, running: boolean) => {
    setBusy(true);
    try {
      await fetch(`/api/gse/${encodeURIComponent(char)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ running }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (action: "startAll" | "stopAll") => {
    setBusy(true);
    try {
      await fetch("/api/gse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-slate-500">
            Controle global
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                label: "Leitor de janelas/whispers",
                desc: "Mantém scan de contas + leitura do chat log ativa.",
                key: "bridgeReaderEnabled" as const,
              },
              {
                label: "Master GSE",
                desc: "Se desligado, nenhuma janela recebe clique/tecla GSE.",
                key: "gseMasterEnabled" as const,
              },
              {
                label: "🎙 Modo voz (tempo real)",
                desc: "Ouve whispers pelo microfone.",
                key: "voiceRelayEnabled" as const,
              },
              {
                label: "🗡 Relay pelo combatlog",
                desc: "Espelha whispers no WoWCombatLog.txt.",
                key: "combatRelayEnabled" as const,
              },
              {
                label: "📷 OCR da tela",
                desc: "Lê whispers direto da tela do jogo.",
                key: "ocrRelayEnabled" as const,
              },
              {
                label: "🖥 Leitor WIM (OCR)",
                desc: "Tira print da janela do WIM e lê a conversa.",
                key: "wimScreenOcrEnabled" as const,
              },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() =>
                  saveControl(
                    { [item.key]: !controls[item.key] },
                    item.key,
                  )
                }
                className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-left transition hover:bg-slate-900/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-100">{item.label}</div>
                    <div className="text-xs text-slate-500">{item.desc}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveControl(
                        { [item.key]: !controls[item.key] },
                        item.key,
                      );
                    }}
                    className={`rounded px-4 py-2 text-xs font-bold whitespace-nowrap ${
                      controls[item.key]
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {controls[item.key] ? "LIGADO" : "DESLIGADO"}
                  </button>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                label: "⏱ Abrir chat no jogo",
                key: "whisperChatOpenDelayMs" as const,
                min: 0,
                max: 3000,
                step: 50,
              },
              {
                label: "⏱ Delay de foco antes de digitar",
                key: "whisperFocusDelayMs" as const,
                min: 100,
                max: 5000,
                step: 100,
              },
              {
                label: "⏱ Entre cada tecla digitada",
                key: "whisperKeystrokeDelayMs" as const,
                min: 10,
                max: 500,
                step: 1,
              },
              {
                label: "⏱ Enviar mensagem (Enter)",
                key: "whisperChatSendDelayMs" as const,
                min: 0,
                max: 3000,
                step: 50,
              },
              {
                label: "⏱ Fechar chat (Escape)",
                key: "whisperChatCloseDelayMs" as const,
                min: 0,
                max: 3000,
                step: 50,
              },
              {
                label: "⏱ Depois de enviar whisper",
                key: "whisperAfterSendDelayMs" as const,
                min: 100,
                max: 5000,
                step: 100,
              },
              {
                label: "⏱ Poll da fila de whisper",
                key: "queuePollMs" as const,
                min: 500,
                max: 10000,
                step: 100,
              },
            ].map((item) => (
              <label key={item.key} className="text-xs text-slate-400">
                {item.label}
                <input
                  type="number"
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={controls[item.key]}
                  onChange={(e) =>
                    saveControl(
                      { [item.key]: Number(e.target.value) },
                      item.key,
                    )
                  }
                  className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                />
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => saveControl({}, "delays")}
              className="w-full rounded bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40 sm:w-auto"
            >
              💾 Salvar delays
            </button>
            <span className="text-xs text-slate-500">
              delays salvos: foco {controls.whisperFocusDelayMs}ms · digitar{" "}
              {controls.whisperKeystrokeDelayMs}ms · enviar{" "}
              {controls.whisperChatSendDelayMs}ms · fechar{" "}
              {controls.whisperChatCloseDelayMs}ms · pós-envio{" "}
              {controls.whisperAfterSendDelayMs}ms
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => bulk("startAll")}
              disabled={busy || states.length === 0}
              className="w-full rounded-lg bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-40 sm:w-auto"
            >
              ▶ Iniciar TODOS ({states.length})
            </button>
            <button
              type="button"
              onClick={() => bulk("stopAll")}
              disabled={busy || states.length === 0}
              className="w-full rounded-lg bg-rose-500 px-6 py-3 text-sm font-bold text-white shadow hover:bg-rose-400 disabled:opacity-40 sm:w-auto"
            >
              ⏹ Parar TODOS
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="relative overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-900/80 to-transparent sm:hidden" />
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="bg-slate-900/60 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Personagem</th>
                <th className="px-4 py-3">Slot</th>
                <th className="px-4 py-3">Status janela</th>
                <th className="px-4 py-3">Tecla GSE</th>
                <th className="px-4 py-3">Intervalo</th>
                <th className="px-4 py-3">GSE</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {states.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nenhum personagem com GSE registrado.
                  </td>
                </tr>
              ) : (
                states.map((row) => (
                  <tr key={row.character} className="hover:bg-slate-800/20">
                    <td className="px-4 py-3 text-sm font-semibold">{row.character}</td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-400">wow1</td>
                    <td className="px-4 py-3">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">{row.keybind}</td>
                    <td className="px-4 py-3 text-sm">{row.intervalMs}ms</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          row.running ? "bg-emerald-500" : "bg-slate-600"
                        }`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleOne(row.character, !row.running)}
                        disabled={busy}
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          row.running
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {row.running ? "● ON" : "○ OFF"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
