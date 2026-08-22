"use client";

import { useCallback, useEffect, useState } from "react";

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
  ocrStripTopPx: number;
  ocrStripHeightPx: number;
  queuePollMs: number;
};

const BOOL_FIELDS: Array<[keyof Controls, string, string]> = [
  ["bridgeReaderEnabled", "Leitura do bridge", "Ler o WoWChatLog.txt e mandar sussurros para o painel"],
  ["gseMasterEnabled", "GSE master", "Permite que o bridge dispare macros (GSE)"],
  ["whisperCloseChatEnabled", "Fechar chat após enviar", "Fecha a janela de whisper depois do envio"],
  ["ocrRelayEnabled", "Relay por OCR", "Lê whispers da tela via OCR quando não há log"],
  ["wimScreenOcrEnabled", "OCR da tela do WIM", "Lê a janela flutuante do addon WIM"],
  ["voiceRelayEnabled", "Voice relay", "Anuncia sussurros em voz alta (TTS)"],
  ["combatRelayEnabled", "Combat relay", "Relay também durante combate"],
];

const NUM_FIELDS: Array<[keyof Controls, string, number, number, number]> = [
  ["queuePollMs", "Intervalo de poll da fila (ms)", 500, 10000, 100],
  ["whisperFocusDelayMs", "Delay ao focar a janela (ms)", 100, 5000, 50],
  ["whisperChatOpenDelayMs", "Delay para abrir o chat (ms)", 0, 3000, 50],
  ["whisperKeystrokeDelayMs", "Delay entre teclas (ms)", 10, 500, 5],
  ["whisperChatSendDelayMs", "Delay após enviar (ms)", 0, 3000, 50],
  ["whisperChatCloseDelayMs", "Delay para fechar o chat (ms)", 0, 3000, 50],
  ["ocrStripTopPx", "OCR — topo da faixa (px)", 0, 200, 1],
  ["ocrStripHeightPx", "OCR — altura da faixa (px)", 60, 260, 1],
];

export function SettingsView() {
  const [controls, setControls] = useState<Controls | null>(null);
  const [bridgeToken, setBridgeToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/control", { cache: "no-store" });
    const data = (await res.json()) as { controls: Controls };
    setControls(data.controls);
  }, []);

  useEffect(() => {
    setBridgeToken(window.localStorage.getItem("bw:bridge-token") ?? "");
    void load();
  }, [load]);

  const save = async () => {
    if (!controls) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: bridgeToken.trim()
          ? {
              "content-type": "application/json",
              authorization: `Bearer ${bridgeToken.trim()}`,
            }
          : { "content-type": "application/json" },
        body: JSON.stringify(controls),
      });
      if (!res.ok) {
        setMsg("❌ Token inválido ou ausente. Informe o mesmo BRIDGE_TOKEN do .exe.");
        return;
      }
      const data = (await res.json()) as { controls: Controls };
      setControls(data.controls);
      setMsg("✅ Configurações salvas — o bridge pega os novos valores no próximo poll.");
    } finally {
      setSaving(false);
    }
  };

  if (!controls) {
    return <p className="text-sm text-slate-500">carregando…</p>;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Configurações do bridge</h1>
        <p className="text-sm text-slate-400">
          Estes valores ficam na tabela <code>app_settings</code> e são lidos pelo
          bridge em <code>/api/control</code> a cada ciclo.
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <label className="block text-sm font-medium">
          Token do bridge
          <input
            type="password"
            value={bridgeToken}
            onChange={(e) => {
              const value = e.target.value;
              setBridgeToken(value);
              window.localStorage.setItem("bw:bridge-token", value);
            }}
            placeholder="Mesmo BRIDGE_TOKEN configurado no executável"
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500/60"
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Fica apenas neste navegador e protege as alterações de GSE e controles.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Módulos
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {BOOL_FIELDS.map(([key, label, hint]) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-3"
            >
              <input
                type="checkbox"
                checked={controls[key] as boolean}
                onChange={(e) =>
                  setControls({ ...controls, [key]: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 accent-emerald-500"
              />
              <span>
                <span className="block text-sm">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Timings
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {NUM_FIELDS.map(([key, label, min, max, step]) => (
            <label key={key} className="block">
              <span className="flex items-center justify-between text-sm">
                {label}
                <span className="text-xs text-slate-400">
                  {controls[key] as number}
                </span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={controls[key] as number}
                onChange={(e) =>
                  setControls({ ...controls, [key]: Number(e.target.value) })
                }
                className="mt-2 w-full accent-emerald-500"
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {saving ? "salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-white/10"
        >
          Recarregar
        </button>
        {msg ? <span className="text-sm text-emerald-300">{msg}</span> : null}
      </div>
    </div>
  );
}
