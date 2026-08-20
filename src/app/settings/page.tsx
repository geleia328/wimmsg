"use client";

import Link from "next/link";
import { useState } from "react";

export default function SettingsPage() {
  const [adminToken, setAdminToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [bridgeToken, setBridgeToken] = useState("");
  const [timeout, setTimeoutValue] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (adminToken) headers["x-admin-token"] = adminToken;

  async function login() {
    setBusy("login");
    try {
      const res = await fetch("/api/admin/settings", {
        headers: adminToken ? { "x-admin-token": adminToken } : undefined,
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { pendingTimeoutMinutes?: number };
        setTimeoutValue(data.pendingTimeoutMinutes ?? 0);
        setUnlocked(true);
        setMsg("✅ acesso liberado");
      } else {
        setMsg("❌ token inválido");
      }
    } finally {
      setBusy(null);
    }
  }

  async function initDb() {
    setBusy("init");
    try {
      const res = await fetch("/api/admin/init-db", { method: "POST", headers });
      setMsg(res.ok ? "✅ banco criado/atualizado" : "❌ falha ao criar banco");
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy("rotate");
    try {
      const res = await fetch("/api/admin/settings", { method: "PUT", headers });
      if (res.ok) {
        const data = (await res.json()) as { bridgeToken: string };
        setBridgeToken(data.bridgeToken);
        setMsg("✅ token gerado");
      }
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers,
        body: JSON.stringify({ bridgeToken, pendingTimeoutMinutes: timeout }),
      });
      setMsg(res.ok ? "✅ salvo" : "❌ falha ao salvar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link className="text-xs text-amber-400 hover:underline" href="/">
            ← voltar ao chat
          </Link>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Configurações</h1>
          <p className="mt-2 text-sm text-slate-400">
            Central para ajustar token do bridge e verificar banco/servidor.
          </p>
        </div>
        <div className="hidden text-4xl sm:block">⚙️</div>
      </div>

      {!unlocked ? (
        <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:mt-8 sm:p-5">
          <h2 className="text-base font-bold text-amber-300 sm:text-lg">
            Acesso admin
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Use o <code>ADMIN_TOKEN</code> se configurou na Vercel. Caso
            contrário, use o <code>BRIDGE_TOKEN</code> atual.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              placeholder="Cole o token admin aqui"
              type="password"
              className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void login();
              }}
            />
            <button
              className="w-full rounded bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 sm:w-auto"
              onClick={login}
              disabled={busy === "login"}
            >
              Entrar
            </button>
          </div>
          {msg && <p className="mt-3 text-xs text-slate-400">{msg}</p>}
        </section>
      ) : (
        <section className="mt-6 space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:mt-8 sm:p-5">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div>
              <div className="font-bold text-slate-100">Banco de dados</div>
              <div className="text-xs text-slate-500">Cria/atualiza tabelas necessárias.</div>
            </div>
            <button className="rounded bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950" onClick={initDb} disabled={busy === "init"}>
              Criar tabelas
            </button>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <label className="text-xs text-slate-400">Bridge token</label>
            <div className="mt-1 flex gap-2">
              <input className="flex-1 rounded bg-slate-800 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60" value={bridgeToken} onChange={(e) => setBridgeToken(e.target.value)} />
              <button className="rounded bg-slate-700 px-3 text-xs font-bold" onClick={rotate} disabled={busy === "rotate"}>Gerar</button>
            </div>
            <label className="mt-4 block text-xs text-slate-400">Timeout pendente (min)</label>
            <input type="number" className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/60" value={timeout} onChange={(e) => setTimeoutValue(Number(e.target.value))} />
            <button className="mt-4 rounded bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400" onClick={save} disabled={busy === "save"}>Salvar</button>
          </div>
          {msg && <p className="text-xs text-slate-400">{msg}</p>}
        </section>
      )}
    </div>
  );
}
