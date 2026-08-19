"use client";

import { useCallback, useEffect, useState } from "react";
import { Layout } from "@/components/Layout";

type Status = {
  ok: boolean;
  dbOnline: boolean;
  envBridgeToken: boolean;
  envAdminToken: boolean;
  dbBridgeTokenSet: boolean;
  pendingTimeoutMinutes: number;
};

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [timeout, setTimeoutVal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const initDb = async () => {
    setBusy("init");
    try {
      const res = await fetch("/api/admin/init-db", { method: "POST" });
      const d = (await res.json()) as { ok: boolean };
      if (d.ok) flash("✅ Tabelas criadas");
      else flash("❌ Erro ao criar tabelas");
    } finally {
      setBusy(null);
    }
  };

  const rotateToken = async () => {
    setBusy("rotate");
    try {
      const res = await fetch("/api/admin/settings", { method: "PUT" });
      const d = (await res.json()) as { bridgeToken: string };
      setToken(d.bridgeToken);
      flash("🔑 Novo token gerado");
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async () => {
    setBusy("save");
    try {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bridgeToken: token, pendingTimeoutMinutes: timeout }),
      });
      flash("💾 Configurações salvas");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Layout>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {toast && (
          <div className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Banco de dados
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                {status?.dbOnline ? "🟢 Conectado" : "🔴 Sem conexão"}
              </p>
            </div>
            <button
              type="button"
              onClick={initDb}
              disabled={busy === "init"}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy === "init" ? "Criando..." : "Criar tabelas"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Token do bridge
          </h2>
          <label className="mb-1 block text-xs text-slate-400">
            Bridge token (usado pelo .exe)
          </label>
          <div className="flex gap-2">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Cole um token ou gere um novo"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={rotateToken}
              disabled={busy === "rotate"}
              className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/20 disabled:opacity-40"
            >
              Gerar
            </button>
          </div>

          <label className="mb-1 mt-4 block text-xs text-slate-400">
            Timeout de mensagens pendentes (minutos · 0 = nunca)
          </label>
          <input
            type="number"
            min={0}
            max={1440}
            value={timeout}
            onChange={(e) => setTimeoutVal(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500/50 focus:outline-none"
          />

          <button
            type="button"
            onClick={saveToken}
            disabled={busy === "save"}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy === "save" ? "Salvando..." : "Salvar configurações"}
          </button>
        </div>
      </div>
    </Layout>
  );
}
