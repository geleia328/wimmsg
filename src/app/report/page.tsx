"use client";

import Link from "next/link";

export default function ReportPage() {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">📊 Relatório</h1>
      </header>
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-slate-400">Relatórios de atividade estarão disponíveis em breve.</p>
      </div>
    </div>
  );
}
