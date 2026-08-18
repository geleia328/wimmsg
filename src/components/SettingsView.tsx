"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type SettingsPayload = {
  ok: boolean;
  tablesReady: boolean;
  tableErrors?: Record<string, string | null>;
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

  // Vercel env updater form. These are intentionally NOT persisted in the
  // browser except the project name, so secrets are not left behind by default.
  const [vercelToken, setVercelToken] = useState("");
  const [vercelProject, setVercelProject] = useState("wimmsg-lntm");
  const [vercelTeamId, setVercelTeamId] = useState("");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [envBridgeToken, setEnvBridgeToken] = useState("");
  const [deployHookUrl, setDeployHookUrl] = useState("");

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

  const initDb = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/admin/init-db", {
        method: "POST",
        headers: headers(),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!r.ok || !data.ok) {
        setError(data.error ?? `Erro HTTP ${r.status}`);
        return;
      }
      await load();
      alert("Tabelas criadas/atualizadas com sucesso!");
    } finally {
      setSaving(false);
    }
  }, [headers, load]);

  const updateVercelEnv = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/admin/vercel-env", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          vercelToken,
          projectIdOrName: vercelProject,
          teamId: vercelTeamId || undefined,
          databaseUrl: databaseUrl || undefined,
          bridgeToken: envBridgeToken || undefined,
          deployHookUrl: deployHookUrl || undefined,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        updated?: string[];
        nextStep?: string;
      };
      if (!r.ok || !data.ok) {
        setError(data.error ?? `Erro HTTP ${r.status}`);
        return;
      }
      setDatabaseUrl("");
      setEnvBridgeToken("");
      alert(
        `Variáveis atualizadas: ${(data.updated ?? []).join(", ")}\n\n${data.nextStep ?? "Faça redeploy na Vercel."}`,
      );
    } finally {
      setSaving(false);
    }
  }, [
    databaseUrl,
    deployHookUrl,
    envBridgeToken,
    headers,
    vercelProject,
    vercelTeamId,
    vercelToken,
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
          {!settings.tablesReady && (
            <section className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
              <h2 className="text-lg font-bold text-amber-300">
                Banco conectado, mas tabelas não existem
              </h2>
              <p className="mt-2 text-sm text-amber-100">
                O Neon já está acessível, mas ainda falta criar as tabelas do
                Bakers Whisper. Clique no botão abaixo para inicializar tudo
                automaticamente.
              </p>
              <button
                onClick={() => void initDb()}
                disabled={saving}
                className="mt-4 rounded bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
              >
                {saving ? "criando..." : "🧱 Criar/atualizar tabelas agora"}
              </button>
              {settings.tableErrors && (
                <pre className="mt-4 max-h-40 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-400">
                  {JSON.stringify(settings.tableErrors, null, 2)}
                </pre>
              )}
            </section>
          )}

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
              DATABASE_URL atual: {settings.database.maskedUrl || "não configurada"}
            </div>
            <div className="mt-3 rounded border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-100">
              <b>Alterar DATABASE_URL pela Vercel API</b>
              <p className="mt-1 text-xs text-sky-200/80">
                Cole abaixo sua Pooled connection string do Neon, um Vercel
                Access Token e o nome/id do projeto. O site atualizará as
                Environment Variables da Vercel para você.
              </p>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs text-slate-400">
                Vercel Access Token
                <input
                  value={vercelToken}
                  onChange={(e) => setVercelToken(e.target.value)}
                  type="password"
                  placeholder="Cole um token da Vercel aqui"
                  className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/60"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Projeto Vercel / ID
                  <input
                    value={vercelProject}
                    onChange={(e) => setVercelProject(e.target.value)}
                    placeholder="wimmsg-lntm"
                    className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/60"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Team ID (opcional)
                  <input
                    value={vercelTeamId}
                    onChange={(e) => setVercelTeamId(e.target.value)}
                    placeholder="team_xxx se o projeto estiver em equipe"
                    className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/60"
                  />
                </label>
              </div>

              <label className="text-xs text-slate-400">
                Nova DATABASE_URL do Neon
                <textarea
                  value={databaseUrl}
                  onChange={(e) => setDatabaseUrl(e.target.value)}
                  rows={3}
                  placeholder="postgresql://neondb_owner:SENHA@ep-xxx-pooler.../neondb?sslmode=require"
                  className="mt-1 w-full resize-none rounded bg-slate-800 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/60"
                />
              </label>

              <label className="text-xs text-slate-400">
                BRIDGE_TOKEN de produção (opcional)
                <input
                  value={envBridgeToken}
                  onChange={(e) => setEnvBridgeToken(e.target.value)}
                  type="password"
                  placeholder="Se quiser atualizar também o token env da Vercel"
                  className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/60"
                />
              </label>

              <label className="text-xs text-slate-400">
                Deploy Hook URL (opcional, para redeploy automático)
                <input
                  value={deployHookUrl}
                  onChange={(e) => setDeployHookUrl(e.target.value)}
                  placeholder="https://api.vercel.com/v1/integrations/deploy/..."
                  className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/60"
                />
              </label>

              <button
                onClick={() => void updateVercelEnv()}
                disabled={saving || !vercelToken || !vercelProject || (!databaseUrl && !envBridgeToken)}
                className="rounded bg-sky-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
              >
                {saving ? "atualizando..." : "☁️ Atualizar variáveis na Vercel"}
              </button>
            </div>

            <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
              Depois de alterar <code>DATABASE_URL</code>, a Vercel precisa de
              um <b>Redeploy</b>. Se você não preencher Deploy Hook URL, vá em
              Vercel → Deployments → três pontinhos → Redeploy.
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
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
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
