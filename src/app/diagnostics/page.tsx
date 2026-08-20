"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";

type Check = { name: string; ok: boolean; detail: string };
type Conversation = {
  character: string;
  player: string;
  lastAt: string;
  lastBody: string;
  lastDirection: string;
};

export default function DiagnosticsPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString("pt-BR")} ${line}`, ...l].slice(0, 50));

  async function refresh() {
    const next: Check[] = [];
    try {
      const health = await fetch("/api/health", { cache: "no-store" });
      next.push({ name: "Health", ok: health.ok, detail: health.ok ? "API online" : `HTTP ${health.status}` });
    } catch (e) {
      next.push({ name: "Health", ok: false, detail: String(e) });
    }
    try {
      const queue = await fetch("/api/queue", { cache: "no-store" });
      next.push({ name: "Auth bridge", ok: queue.ok, detail: queue.ok ? "token/API OK ou modo dev" : `HTTP ${queue.status}` });
    } catch (e) {
      next.push({ name: "Auth bridge", ok: false, detail: String(e) });
    }
    try {
      const status = await fetch("/api/status", { cache: "no-store" });
      const data = status.ok ? ((await status.json()) as { windows: unknown[] }) : { windows: [] };
      next.push({ name: "Janelas reportadas", ok: status.ok, detail: `${data.windows.length} janela(s) no site` });
    } catch (e) {
      next.push({ name: "Janelas reportadas", ok: false, detail: String(e) });
    }
    try {
      const conv = await fetch("/api/conversations", { cache: "no-store" });
      const data = conv.ok ? ((await conv.json()) as { conversations: Conversation[] }) : { conversations: [] };
      setConversations(data.conversations.slice(0, 10));
      next.push({ name: "Conversas", ok: conv.ok, detail: `${data.conversations.length} conversa(s)` });
    } catch (e) {
      next.push({ name: "Conversas", ok: false, detail: String(e) });
    }
    setChecks(next);
  }

  async function runInboundTest() {
    setRunning(true);
    const character = "diagnostico-site";
    const player = `teste-${Date.now().toString().slice(-5)}`;
    const body = "mensagem inbound falsa criada pelo diagnóstico";
    try {
      pushLog("POST /api/ingest simulando WoW → site...");
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              externalId: `diag-${Date.now()}`,
              character,
              player,
              body,
              direction: "incoming",
              receivedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      const text = await res.text();
      pushLog(`${res.ok ? "✅" : "❌"} ingest respondeu: ${text}`);
      await refresh();
    } catch (e) {
      pushLog(`❌ erro no teste inbound: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  async function runRelayParserTest() {
    setRunning(true);
    const body = `WIMRELAY<OWN:Simplat-Azralon><FROM:Comprador-Azralon><TS:${Math.floor(Date.now() / 1000)}>teste relay real do addon`;
    try {
      pushLog("POST /api/ingest com linha WIMRELAY igual ao addon...");
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: { character: "unknown", player: "unknown", body } }),
      });
      const text = await res.text();
      pushLog(`${res.ok ? "✅" : "❌"} relay respondeu: ${text}`);
      await refresh();
    } catch (e) {
      pushLog(`❌ erro no teste WIMRELAY: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-5xl overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-bold text-amber-300">Diagnóstico de mão dupla</div>
          <p className="mt-1 text-xs">
            Se os testes abaixo criam conversa no site, a API está OK. Nesse caso,
            o problema fica entre addon/bridge/OCR local. Como seu addon mostra
            “whispers capturados”, o caminho principal é o OCR da faixa amarela
            lendo <b>WIMRELAY</b> em tempo real. Se aparecer erro de <b>winrt</b>,
            o .exe antigo foi compilado sem PyWinRT.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="text-base font-bold text-slate-100">Status</h2>
            <div className="mt-3 space-y-2">
              {checks.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3 rounded bg-slate-950 px-3 py-2 text-sm">
                  <span>{c.ok ? "✅" : "❌"} {c.name}</span>
                  <span className="text-xs text-slate-400">{c.detail}</span>
                </div>
              ))}
            </div>
            <button onClick={refresh} className="mt-3 rounded bg-slate-700 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-slate-600">
              Atualizar
            </button>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="text-base font-bold text-slate-100">Testes rápidos</h2>
            <div className="mt-3 flex flex-col gap-2">
              <button disabled={running} onClick={runInboundTest} className="rounded bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40">
                Testar WoW → site falso
              </button>
              <button disabled={running} onClick={runRelayParserTest} className="rounded bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40">
                Testar parser WIMRELAY do addon
              </button>
              <Link href="/" className="rounded border border-slate-700 px-4 py-2 text-center text-sm text-slate-300 hover:bg-slate-800">
                Abrir chat
              </Link>
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-base font-bold text-slate-100">Checklist no WoW/bridge</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
            <li>No WoW: <code className="rounded bg-slate-800 px-1.5 text-amber-300">/wimbridge who</code> deve mostrar eventos OK e contador aumentando.</li>
            <li>No WoW: a faixa amarela do addon deve aparecer quando chega whisper (<b>WIMRELAY&lt;OWN...&gt;</b>).</li>
            <li>No bridge novo: precisa aparecer <code className="rounded bg-slate-800 px-1.5 text-emerald-300">v1.4.8</code> ou maior.</li>
            <li>Se aparecer erro <b>No module named winrt...</b>, baixe o .exe novo gerado pela Action — o antigo não tem OCR empacotado.</li>
            <li>Ao receber whisper real, o bridge deve logar <b>📷 ← OCR</b>. Se não logar, o OCR local ainda não está funcionando.</li>
          </ol>
        </section>

        <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-base font-bold text-slate-100">Últimas conversas</h2>
          <div className="mt-3 divide-y divide-slate-800 rounded bg-slate-950">
            {conversations.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">Nenhuma conversa ainda.</div>
            ) : (
              conversations.map((c) => (
                <div key={`${c.character}-${c.player}`} className="p-3 text-sm">
                  <div className="font-semibold text-slate-100">{c.character} ↔ {c.player}</div>
                  <div className="truncate text-xs text-slate-400">{c.lastDirection}: {c.lastBody}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
          <h2 className="text-base font-bold text-slate-100">Log da aba</h2>
          <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs text-slate-400">
            {log.length ? log.join("\n") : "Sem ações ainda."}
          </pre>
        </section>
      </div>
    </Layout>
  );
}
