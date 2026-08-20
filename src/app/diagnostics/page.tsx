"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function DiagnosticsPage() {
  const [health, setHealth] = useState<{ ok: boolean } | null>(null);
  const [ingest, setIngest] = useState<{ ok: boolean; totalMessages: number } | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const [h, i] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/ingest", { cache: "no-store" }),
        ]);
        if (h.ok) setHealth(await h.json() as { ok: boolean });
        if (i.ok) setIngest(await i.json() as { ok: boolean; totalMessages: number });
      } catch {
        // ignore
      }
    };
    void run();
  }, []);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">🧪 Diagnóstico</h1>
      </header>
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <h2 className="mb-2 font-bold">Health Check</h2>
          <p className="text-sm">
            {health === null
              ? "Verificando..."
              : health.ok
                ? "✅ Servidor e banco de dados online"
                : "❌ Servidor offline"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <h2 className="mb-2 font-bold">Mensagens no banco</h2>
          <p className="text-sm">
            {ingest === null
              ? "Verificando..."
              : `${ingest.totalMessages} mensagens armazenadas`}
          </p>
        </div>
      </div>
    </div>
  );
}
