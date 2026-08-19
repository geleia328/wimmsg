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
  voiceRelayEnabled: false,
  combatRelayEnabled: false,
  ocrRelayEnabled: true,
  wimScreenOcrEnabled: false,
  queuePollMs: 1500,
};

export default function GsePage() {
  const [controls, setControls] = useState<Controls>(EMPTY);
  const [states, setStates] = useState<GseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [cRes, gRes] = await Promise.all([
        fetch("/api/control", { cache: "no-store" }),
        fetch("/api/gse", { cache: "no-store" }),
      ]);
      if (cRes.ok) setControls(((await cRes.json()) as { controls: Controls }).controls);
      if (gRes.ok) setStates(((await gRes.json()) as { states: GseRow[] }).states);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const saveControl = async (patch: Partial<Controls>, label = "Configuração salva") => {
    setBusy(true);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setControls(((await res.json()) as { controls: Controls }).controls);
        setMsg(`✅ ${label}`);
      } else {
        setMsg("❌ Falha ao salvar");
      }
    } finally {
      setBusy(false);
    }
  };

  const safeMode = async () => {
    await saveControl(
      {
        bridgeReaderEnabled: true,
        ocrRelayEnabled: true,
        wimScreenOcrEnabled: false,
        voiceRelayEnabled: false,
        combatRelayEnabled: false,
      },
      "Modo limpo aplicado: addon/chatlog + OCR da faixa, sem voz/WIM/combat",
    );
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
      <div className="mx-auto w-full max-w-5xl overflow-y-auto px-4 py-6 sm:px-6">
        <section className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-bold text-amber-300">Modo recomendado</div>
          <p className="mt-1 text-xs">
            Mantive somente o necessário: leitor do bridge, GSE, delays e OCR da
            faixa amarela do addon. Removi da tela os controles instáveis de voz,
            combatlog e OCR WIM da janela inteira.
          </p>
          <button
            disabled={busy}
            onClick={safeMode}
            className="mt-3 rounded bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
          >
            Aplicar modo limpo recomendado
          </button>
          {msg && <p className="mt-2 text-xs text-slate-300">{msg}</p>}
        </section>

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-slate-500">
            Controles essenciais
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ToggleCard
              label="Leitor de whispers"
              desc="Deixe ligado para WoW → site funcionar."
              value={controls.bridgeReaderEnabled}
              onClick={() => saveControl({ bridgeReaderEnabled: !controls.bridgeReaderEnabled }, "Leitor atualizado")}
            />
            <ToggleCard
              label="OCR da faixa do addon"
              desc="Backup visual do WIMBridge. Não é o OCR WIM inteiro."
              value={controls.ocrRelayEnabled}
              onClick={() => saveControl({ ocrRelayEnabled: !controls.ocrRelayEnabled }, "OCR da faixa atualizado")}
            />
            <ToggleCard
              label="Master GSE"
              desc="Liga/desliga macros GSE em todas as janelas."
              value={controls.gseMasterEnabled}
              onClick={() => saveControl({ gseMasterEnabled: !controls.gseMasterEnabled }, "Master GSE atualizado")}
            />
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-slate-500">
            Delays do envio site → WoW
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Delay label="Abrir chat" value={controls.whisperChatOpenDelayMs} onChange={(v) => saveControl({ whisperChatOpenDelayMs: v }, "Delay salvo")} />
            <Delay label="Foco antes de digitar" value={controls.whisperFocusDelayMs} onChange={(v) => saveControl({ whisperFocusDelayMs: v }, "Delay salvo")} />
            <Delay label="Entre teclas" value={controls.whisperKeystrokeDelayMs} onChange={(v) => saveControl({ whisperKeystrokeDelayMs: v }, "Delay salvo")} />
            <Delay label="Enviar Enter" value={controls.whisperChatSendDelayMs} onChange={(v) => saveControl({ whisperChatSendDelayMs: v }, "Delay salvo")} />
            <Delay label="Fechar chat" value={controls.whisperChatCloseDelayMs} onChange={(v) => saveControl({ whisperChatCloseDelayMs: v }, "Delay salvo")} />
            <Delay label="Poll da fila" value={controls.queuePollMs} onChange={(v) => saveControl({ queuePollMs: v }, "Delay salvo")} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="flex flex-col gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-100">Personagens GSE</div>
              <div className="text-xs text-slate-500">Aparecem quando o bridge reporta estado GSE.</div>
            </div>
            <div className="flex gap-2">
              <button disabled={busy || states.length === 0} onClick={() => bulk("startAll")} className="rounded bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">
                ▶ Todos
              </button>
              <button disabled={busy || states.length === 0} onClick={() => bulk("stopAll")} className="rounded bg-rose-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                ⏹ Parar
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="bg-slate-900/60 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Personagem</th>
                  <th className="px-4 py-3">Tecla</th>
                  <th className="px-4 py-3">Intervalo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {states.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nenhum personagem GSE registrado.
                    </td>
                  </tr>
                ) : (
                  states.map((row) => (
                    <tr key={row.character}>
                      <td className="px-4 py-3 font-semibold">{row.character}</td>
                      <td className="px-4 py-3 font-mono">{row.keybind}</td>
                      <td className="px-4 py-3">{row.intervalMs}ms</td>
                      <td className="px-4 py-3">{row.running ? "🟢 Rodando" : "⚫ Parado"}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => toggleOne(row.character, !row.running)} className="rounded bg-slate-700 px-2 py-1 text-xs font-bold text-slate-100">
                          {row.running ? "Parar" : "Ligar"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function ToggleCard({ label, desc, value, onClick }: { label: string; desc: string; value: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-left hover:bg-slate-900/60">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-slate-100">{label}</div>
          <div className="text-xs text-slate-500">{desc}</div>
        </div>
        <span className={`rounded px-3 py-1 text-xs font-bold ${value ? "bg-emerald-500 text-slate-950" : "bg-slate-700 text-slate-300"}`}>
          {value ? "ON" : "OFF"}
        </span>
      </div>
    </button>
  );
}

function Delay({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <label className="text-xs text-slate-400">
      {label}
      <div className="mt-1 flex gap-2">
        <input
          type="number"
          value={local}
          onChange={(e) => setLocal(Number(e.target.value))}
          className="w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-amber-500/60"
        />
        <button type="button" onClick={() => onChange(local)} className="rounded bg-amber-500 px-2 text-xs font-bold text-slate-950">
          OK
        </button>
      </div>
    </label>
  );
}
