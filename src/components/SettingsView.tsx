"use client";
import { useCallback, useEffect, useState } from "react";

type Settings = Record<string, string>;

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings>({});
  const [env, setEnv] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        fetch("/api/admin/settings", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/admin/vercel-env", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      if (s?.ok) setSettings(s.settings || {});
      if (e?.ok) setEnv(e.env || null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const j = await r.json();
      if (j?.ok) setMsg("Configurações salvas.");
      else setMsg("Erro ao salvar.");
    } catch {
      setMsg("Erro ao salvar.");
    }
    setSaving(false);
  };

  const initDb = async () => {
    setMsg(null);
    try {
      const r = await fetch("/api/admin/init-db", { method: "POST" });
      const j = await r.json();
      setMsg(j?.ok ? "Banco inicializado." : "Erro ao inicializar DB.");
    } catch {
      setMsg("Erro ao inicializar DB.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <p className="mt-1 text-sm text-slate-400">
        Ajustes globais e diagnóstico da sandbox.
      </p>

      {msg && (
        <div className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">{msg}</div>
      )}

      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-medium">Chaves (app_settings)</h2>
        <div className="mt-3 grid gap-3">
          {Object.entries(settings).map(([k, v]) => (
            <label key={k} className="block">
              <span className="font-mono text-xs uppercase text-slate-400">{k}</span>
              <input
                value={v}
                onChange={(e) => setSettings((prev) => ({ ...prev, [k]: e.target.value }))}
                className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "💾 Salvar"}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-medium">Diagnóstico</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <button
              onClick={initDb}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            >
              🛠 Inicializar/atualizar tabelas
            </button>
          </div>
          {env && (
            <div className="mt-3 rounded-lg bg-slate-800 p-3 font-mono text-xs">
              <pre>{JSON.stringify(env, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
