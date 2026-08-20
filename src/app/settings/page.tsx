"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

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

const DELAY_FIELDS: Array<{
  key: keyof Controls;
  label: string;
  desc: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  { key: "whisperFocusDelayMs", label: "Foco na janela", desc: "Delay após focar na janela WoW antes de abrir chat", min: 100, max: 5000, step: 100, unit: "ms" },
  { key: "whisperChatOpenDelayMs", label: "Abrir chat", desc: "Delay após pressionar /w Nome para abrir o whisper", min: 0, max: 3000, step: 100, unit: "ms" },
  { key: "whisperKeystrokeDelayMs", label: "Entre teclas", desc: "Delay entre cada tecla ao digitar a mensagem", min: 10, max: 500, step: 10, unit: "ms" },
  { key: "whisperChatSendDelayMs", label: "Enviar (Enter)", desc: "Delay após digitar antes de pressionar Enter", min: 0, max: 3000, step: 100, unit: "ms" },
  { key: "whisperAfterSendDelayMs", label: "Após enviar", desc: "Delay após enviar antes de processar próxima msg", min: 100, max: 5000, step: 100, unit: "ms" },
  { key: "whisperChatCloseDelayMs", label: "Fechar chat", desc: "Delay antes de fechar a janela de chat após envio", min: 0, max: 3000, step: 100, unit: "ms" },
  { key: "queuePollMs", label: "Poll da fila", desc: "Intervalo de polling do .exe para buscar mensagens pendentes", min: 500, max: 10000, step: 250, unit: "ms" },
  { key: "ocrStripTopPx", label: "OCR faixa topo", desc: "Pixels do topo da faixa OCR do addon", min: 0, max: 200, step: 1, unit: "px" },
  { key: "ocrStripHeightPx", label: "OCR faixa altura", desc: "Altura em pixels da faixa OCR do addon", min: 60, max: 260, step: 1, unit: "px" },
];

const BOOL_FIELDS: Array<{
  key: keyof Controls;
  label: string;
  desc: string;
}> = [
  { key: "whisperCloseChatEnabled", label: "Fechar chat após envio", desc: "Fecha a janela de chat do WoW após enviar a resposta" },
  { key: "ocrRelayEnabled", label: "OCR relay ativo", desc: "Habilita captura via OCR da faixa do addon" },
  { key: "gseMasterEnabled", label: "GSE Master", desc: "Habilita o sistema GSE macro spam" },
];

export default function SettingsPage() {
  const [dbOnline, setDbOnline] = useState(false);
  const [status, setStatus] = useState("");
  const [controls, setControls] = useState<Controls | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadControls = useCallback(async () => {
    try {
      const res = await fetch("/api/control", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; controls: Controls };
        setControls(data.controls);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/admin/settings", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { dbOnline: boolean };
          setDbOnline(data.dbOnline);
        }
      } catch {
        // ignore
      }
    };
    void check();
    void loadControls();
  }, [loadControls]);

  const initDb = async () => {
    setStatus("Criando tabelas...");
    try {
      const res = await fetch("/api/admin/init-db", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; applied?: number; errors?: string[] };
      if (data.ok) {
        setStatus(`✅ ${data.applied} statements aplicados com sucesso!`);
        setDbOnline(true);
      } else {
        setStatus(`❌ Erros: ${data.errors?.join(", ")}`);
      }
    } catch {
      setStatus("❌ Falha na conexão");
    }
  };

  const updateControl = (key: keyof Controls, value: number | boolean) => {
    if (!controls) return;
    setControls({ ...controls, [key]: value });
  };

  const saveControls = async () => {
    if (!controls || saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(controls),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; controls: Controls };
        setControls(data.controls);
        setSaveMsg("✅ Delays salvos! O .exe receberá os novos valores no próximo poll.");
      } else {
        setSaveMsg("❌ Erro ao salvar");
      }
    } catch {
      setSaveMsg("❌ Falha na conexão");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">🔐 Configurações</h1>
      </header>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {/* Database section */}
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <h2 className="mb-2 text-base font-bold">Banco de Dados</h2>
          <p className="text-sm text-slate-400">
            Status: {dbOnline ? <span className="text-emerald-400">✅ Online</span> : <span className="text-rose-400">❌ Offline</span>}
          </p>
          <button
            onClick={initDb}
            className="mt-3 rounded bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500"
          >
            Criar/Atualizar Tabelas
          </button>
          {status && <p className="mt-2 text-sm">{status}</p>}
        </div>

        {/* Delay Controls section */}
        <div className="rounded-lg border border-amber-500/30 bg-slate-800/50 p-5">
          <h2 className="mb-1 text-base font-bold text-amber-400">⏱ Delays do Bridge (.exe)</h2>
          <p className="mb-4 text-xs text-slate-400">
            Esses valores são lidos pelo .exe a cada poll. Altere e clique &quot;Salvar&quot; — o .exe receberá automaticamente no próximo ciclo.
          </p>

          {controls ? (
            <>
              {/* Boolean toggles */}
              <div className="mb-4 space-y-3">
                {BOOL_FIELDS.map((f) => (
                  <label key={f.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={controls[f.key] as boolean}
                      onChange={(e) => updateControl(f.key, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500/50"
                    />
                    <div>
                      <div className="text-sm font-semibold">{f.label}</div>
                      <div className="text-[11px] text-slate-500">{f.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Numeric delays */}
              <div className="space-y-4">
                {DELAY_FIELDS.map((f) => (
                  <div key={f.key}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <label className="text-sm font-semibold">{f.label}</label>
                      <span className="text-xs font-mono text-amber-300">
                        {controls[f.key] as number}{f.unit}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mb-1">{f.desc}</div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={controls[f.key] as number}
                        onChange={(e) => updateControl(f.key, Number(e.target.value))}
                        className="flex-1 accent-amber-500"
                      />
                      <input
                        type="number"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={controls[f.key] as number}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) {
                            updateControl(f.key, Math.max(f.min, Math.min(f.max, v)));
                          }
                        }}
                        className="w-20 rounded bg-slate-700 px-2 py-1 text-right text-sm font-mono text-amber-300 outline-none focus:ring-1 focus:ring-amber-500/60"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={saveControls}
                  disabled={saving}
                  className="rounded bg-amber-600 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-500 disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "💾 Salvar Delays"}
                </button>
                {saveMsg && <span className="text-sm">{saveMsg}</span>}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Carregando controles...</p>
          )}
        </div>

        {/* Info */}
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <h2 className="mb-2 text-base font-bold">ℹ Como funciona</h2>
          <ul className="space-y-1 text-sm text-slate-400">
            <li>• O .exe faz <code className="text-amber-300">GET /api/control</code> a cada poll para ler os delays</li>
            <li>• Ao alterar e salvar aqui, os valores são gravados no banco</li>
            <li>• Na próxima vez que o .exe fizer poll, ele recebe os novos valores</li>
            <li>• Não é necessário reiniciar o .exe — a atualização é automática</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
