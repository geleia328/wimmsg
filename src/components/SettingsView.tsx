"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type SettingsPayload = {
  ok: boolean;
  database: {
    configured: boolean;
    maskedUrl: string;
    note: string;
  };
  bridgeToken: {
    envConfigured: boolean;
    envMasked: string;
    dynamicConfigured: boolean;
    dynamicMasked: string;
    dynamicUpdatedAt: string | null;
  };
  counts: {
    messages: number;
    windows: number;
    gseStates: number;
  };
};

const ADMIN_KEY = "bakers-whisper:admin-token";

export function SettingsView() {
  const [adminToken, setAdminToken] = useState("");
  const [bridgeToken, setBridgeToken] = useState("");
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAdminToken(localStorage.getItem(ADMIN_KEY) ?? "");
  }, []);

  const headers = useCallback(
    () => ({ "x-admin-token": adminToken, "content-type": "application/json" }),
    [adminToken],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      localStorage.setItem(ADMIN_KEY, adminToken);
      const r = await fetch("/api/admin/settings", {
        headers: headers(),
        cache: "no-store",
      });
      if (!r.ok) {
        setSettings(null);
        setError(r.status === 401 ? "Token admin inválido." : await r.text());
        return;
      }
      setSettings((await r.json()) as SettingsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [adminToken, headers]);

  useEffect(() => {
    if (adminToken) void load();
  }, [adminToken, load]);

  const saveBridgeToken = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ bridgeToken }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Erro HTTP ${r.status}`);
        return;
      }
      setBridgeToken("");
      await load();
      alert("Token salvo com sucesso. Coloque esse mesmo token no BakersWhisper.exe.");
    } finally {
      setSaving(false);
    }
  }, [bridgeToken, headers, load]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-amber-400 hover:underline">
            ← voltar ao chat
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Configurações</h1>
          <p className="mt-2 text-sm text-slate-400">
            Central para ajustar token do bridge e verificar banco/servidor.
          </p>
        </div>
        <div className="text-4xl">⚙️</div>
      </div>

      <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-bold text-amber-300">Acesso admin</h2>
        <p className="mt-1 text-xs text-slate-500">
          Use o <code>ADMIN_TOKEN</code> se configurou na Vercel. Caso contrário,
          use o <code>BRIDGE_TOKEN</code> atual.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="Cole o token admin aqui"
            type="password"
            className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
          />
          <button
            onClick={() => void load()}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
          >
            Entrar
          </button>
        </div>
        {error && (
          <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}
      </section>

      {settings && (
        <>
          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-lg font-bold text-emerald-300">Status</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Mensagens" value={settings.counts.messages} />
              <Stat label="Janelas" value={settings.counts.windows} />
              <Stat label="GSE states" value={settings.counts.gseStates} />
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-lg font-bold text-sky-300">PostgreSQL / Neon</h2>
            <div className="mt-3 rounded bg-slate-950 p-3 font-mono text-xs text-slate-300">
              DATABASE_URL: {settings.database.maskedUrl || "não configurada"}
            </div>
            <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              <b>Por segurança, a URL do Postgres não pode ser editada aqui.</b>
              <p className="mt-1 text-xs">
                O site precisa da <code>DATABASE_URL</code> antes de conseguir
                abrir qualquer página ou ler o banco. No Vercel, altere em:
                <br />
                <b>Project → Settings → Environment Variables → DATABASE_URL</b>
                <br />
                Depois clique em <b>Redeploy</b>.
              </p>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-lg font-bold text-fuchsia-300">Bridge Token</h2>
            <p className="mt-2 text-sm text-slate-400">
              Esse token é o que o BakersWhisper.exe usa para falar com o site.
              Você pode trocar aqui sem recompilar o instalador.
            </p>
            <div className="mt-3 space-y-2 text-xs text-slate-400">
              <div>
                Token da Vercel/env: {settings.bridgeToken.envConfigured ? settings.bridgeToken.envMasked : "não configurado"}
              </div>
              <div>
                Token dinâmico do site: {settings.bridgeToken.dynamicConfigured ? settings.bridgeToken.dynamicMasked : "não configurado"}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <input
                value={bridgeToken}
                onChange={(e) => setBridgeToken(e.target.value)}
                placeholder="Novo Bridge Token (mínimo 16 caracteres)"
                type="password"
                className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-fuchsia-500/60"
              />
              <button
                onClick={() => void saveBridgeToken()}
                disabled={saving || bridgeToken.length < 16}
                className="rounded bg-fuchsia-500 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-400 disabled:opacity-40"
              >
                {saving ? "salvando..." : "Salvar token"}
              </button>
            </div>
            <div className="mt-4 rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
              Depois de salvar, abra o <b>BakersWhisper.exe</b> → seção
              <b> Servidor</b> → cole o mesmo token → <b>💾 Salvar servidor</b>
              → <b>🌐 Testar</b>.
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}
