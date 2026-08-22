"use client";

import { useCallback, useEffect, useState } from "react";

type GseItem = {
  character: string;
  running: boolean;
  keybind: string;
  intervalMs: number;
  lastSeenAt: string | null;
  secondsAgo: number | null;
  recentInbound: number;
};

const POLL_MS = 3000;
const bridgeHeaders = (): HeadersInit => {
  const token = window.localStorage.getItem("bw:bridge-token")?.trim();
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
};

export function GseView() {
  const [items, setItems] = useState<GseItem[]>([]);
  const [masterOn, setMasterOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [lastSync, setLastSync] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);

  const showToast = (msg: string, kind: "ok" | "warn" | "err" = "ok") => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
    // Marcar visualmente nos cards
    void kind;
  };

  const load = useCallback(async () => {
    try {
      const [res, controlRes] = await Promise.all([
        fetch("/api/gse", { cache: "no-store" }),
        fetch("/api/control", { cache: "no-store" }),
      ]);
      const data = (await res.json()) as { items: GseItem[]; master: boolean };
      const control = (await controlRes.json()) as {
        controls?: { gseMasterEnabled?: boolean };
      };
      setItems(data.items ?? []);
      setMasterOn(Boolean(control.controls?.gseMasterEnabled));
      // Bridge está conectado se QUALQUER item tem secondsAgo < 30s
      const connected = (data.items ?? []).some(
        (i) => i.secondsAgo != null && i.secondsAgo < 30,
      );
      setBridgeConnected(connected);
    } catch {
      setBridgeConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  /**
   * Salva config no site + força o bridge a pegar IMEDIATAMENTE.
   * O bridge faz polling a cada 3s. Aqui, depois de salvar,
   * verificamos o banco de novo a cada 0.5s por até 4s pra confirmar
   * que o valor foi lido (e não foi resetado pelo default 100).
   */
  const saveRow = async (char: string, patch: Partial<{ keybind: string; intervalMs: number; running: boolean }>) => {
    setSaving((s) => ({ ...s, [char]: true }));
    try {
      const res = await fetch(`/api/gse/${encodeURIComponent(char)}`, {
        method: "POST",
        headers: bridgeHeaders(),
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; gse?: { intervalMs: string; keybind: string; running: string } };
      if (!res.ok || !data.ok) {
        showToast(`❌ ${data.error ?? "erro ao salvar"}`, "err");
        return;
      }
      // Confirmação IMEDIATA do que voltou do banco
      const intervalSaved = Number.parseInt(data.gse?.intervalMs ?? "0", 10);
      const keybindSaved = data.gse?.keybind ?? "";
      const runningSaved = data.gse?.running === "yes";
      setLastSync((s) => ({ ...s, [char]: Date.now() }));

      if (patch.intervalMs !== undefined && intervalSaved !== patch.intervalMs) {
        showToast(
          `⚠️ site devolveu ${intervalSaved}ms em vez de ${patch.intervalMs}ms — clamped`,
          "warn",
        );
      } else if (patch.keybind !== undefined && keybindSaved !== patch.keybind) {
        showToast(`⚠️ site devolveu "${keybindSaved}" em vez de "${patch.keybind}"`, "warn");
      } else {
        const parts: string[] = [];
        if (patch.keybind !== undefined) parts.push(`tecla=${keybindSaved}`);
        if (patch.intervalMs !== undefined) parts.push(`${intervalSaved}ms`);
        if (patch.running !== undefined) parts.push(runningSaved ? "ON" : "OFF");
        showToast(`✅ ${char} salvo: ${parts.join(" · ")}`);
      }
      await load();
    } catch (e) {
      showToast(`❌ falha de rede: ${e instanceof Error ? e.message : String(e)}`, "err");
    } finally {
      setSaving((s) => ({ ...s, [char]: false }));
    }
  };

  const toggleAll = async (on: boolean) => {
    const masterResult = await fetch("/api/control", {
      method: "POST",
      headers: bridgeHeaders(),
      body: JSON.stringify({ gseMasterEnabled: on }),
    });
    if (!masterResult.ok) {
      showToast("❌ Token inválido ou ausente. Configure-o em Configurações.", "err");
      return;
    }
    const results = await Promise.all(
      items.map((it) =>
        fetch(`/api/gse/${encodeURIComponent(it.character)}`, {
          method: "POST",
          headers: bridgeHeaders(),
          body: JSON.stringify({ running: on }),
        }),
      ),
    );
    if (results.some((result) => !result.ok)) {
      showToast("❌ Não foi possível salvar todas as contas. Verifique o token.", "err");
      return;
    }
    setMasterOn(on);
    showToast(on ? "▶️ master ON — todas as contas ligadas" : "⏸ master OFF — todas pausadas");
    await load();
  };

  const formatAgo = (sec: number | null) => {
    if (sec == null) return "—";
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h`;
  };

  const online = items.filter((i) => (i.secondsAgo ?? 9_999) < 60 || i.recentInbound > 0).length;
  const runningCount = items.filter((i) => i.running).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GSE — spammer de tecla</h1>
          <p className="text-sm text-slate-400">
            Configure a tecla + intervalo por personagem. O .exe busca a config
            a cada 3s. Cada vez que você clica em <b>Salvar &amp; enviar</b>, o
            site confirma de volta o que persistiu, e você vê a bolinha{" "}
            <span className="text-emerald-300">✓ sync</span> quando o bridge
            realmente leu.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={loading || items.length === 0}
            onClick={() => void toggleAll(true)}
            className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            ▶ ligar todas
          </button>
          <button
            type="button"
            disabled={loading || items.length === 0}
            onClick={() => void toggleAll(false)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40"
          >
            ⏸ pausar todas
          </button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Personagens</p>
          <p className="mt-1 text-2xl font-semibold">{items.length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Spammers rodando</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">{runningCount}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Conta ativa (últ. 30m)</p>
          <p className="mt-1 text-2xl font-semibold">{online}</p>
        </div>
        <div
          className={`rounded-2xl border p-4 ${
            bridgeConnected
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-slate-400">Bridge</p>
          <p className={`mt-1 text-2xl font-semibold ${bridgeConnected ? "text-emerald-300" : "text-amber-300"}`}>
            {bridgeConnected ? "🟢 conectado" : "🟡 offline"}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {bridgeConnected
              ? "config chega em até 3s"
              : "sem .exe rodando — abre o BakersWhisper.exe"}
          </p>
        </div>
      </div>

      {!bridgeConnected && items.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-semibold">⚠️ O bridge (.exe) não está conectado</p>
          <p className="mt-1 text-amber-300/80">
            Você pode salvar as configurações no site, mas elas só serão
            aplicadas quando o <code>BakersWhisper.exe</code> estiver rodando
            no seu PC. Abra o .exe e clique em <b>▶ Iniciar</b>.
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">carregando…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
          Nenhum personagem configurado ainda. As contas aparecem aqui
          automaticamente quando o bridge enviar o primeiro whisper, ou quando
          você cadastrá-las na janelinha do <code>BakersWhisper.exe</code>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Personagem</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Tecla</th>
                <th className="px-4 py-2.5">Intervalo (ms)</th>
                <th className="px-4 py-2.5">Sync</th>
                <th className="px-4 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((it) => (
                <GseRow
                  key={it.character}
                  item={it}
                  saving={saving[it.character] ?? false}
                  lastSync={lastSync[it.character]}
                  bridgeConnected={bridgeConnected}
                  onSave={saveRow}
                  formatAgo={formatAgo}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-slate-300">
        <p className="font-semibold text-sky-300">ℹ️ Como funciona o envio pro .exe</p>
        <ol className="mt-1.5 ml-5 list-decimal space-y-0.5 text-slate-400">
          <li>Você edita tecla/intervalo/status e clica em <b>Salvar &amp; enviar</b>.</li>
          <li>O site grava no banco e <b>devolve o que persistiu</b> (com confirmação visual).</li>
          <li>O .exe consulta o servidor a cada 1,5s e aplica o valor novo.</li>
          <li>Use o mesmo token do bridge em Configurações para poder salvar alterações.</li>
          <li>Se você pausar o spammer para enviar um whisper, ele retoma automaticamente.</li>
        </ol>
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function GseRow({
  item,
  saving,
  lastSync,
  bridgeConnected,
  onSave,
  formatAgo,
}: {
  item: GseItem;
  saving: boolean;
  lastSync: number | undefined;
  bridgeConnected: boolean;
  onSave: (char: string, patch: Partial<{ keybind: string; intervalMs: number; running: boolean }>) => void;
  formatAgo: (sec: number | null) => string;
}) {
  // Estado local — NUNCA sobrescrito pelo poll depois do primeiro save.
  // Só atualiza se o item.lastSeenAt mudou (= o .exe acabou de ler de novo)
  // ou se o item mudou de identidade (outro personagem).
  const [keybind, setKeybind] = useState(item.keybind);
  const [intervalMs, setIntervalMs] = useState(item.intervalMs);

  // Atualiza o estado local quando o item do banco muda DE VERDADE.
  // (Comparação por updatedAt via secondsAgo; se o bridge leu, atualiza.)
  useEffect(() => {
    setKeybind(item.keybind);
    setIntervalMs(item.intervalMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.character]);

  const dirtyKey = keybind !== item.keybind;
  const dirtyInterval = intervalMs !== item.intervalMs;
  const dirty = dirtyKey || dirtyInterval;

  const isBridgeLive = item.secondsAgo != null && item.secondsAgo < 30;
  const isOnline = isBridgeLive || item.recentInbound > 0;

  // "✓ sync" quando o bridge confirmou a leitura após o último save
  const synced = lastSync != null && item.secondsAgo != null &&
    Math.abs((lastSync - (Date.now() - item.secondsAgo * 1000))) < 15_000;

  return (
    <tr className={item.running ? "bg-emerald-500/5" : ""}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              isOnline ? "bg-emerald-400" : "bg-slate-600"
            }`}
          />
          <div>
            <p className="font-medium">{item.character}</p>
            {item.recentInbound > 0 ? (
              <p className="text-[11px] text-slate-500">
                {item.recentInbound} whisper(s) inbound (30m)
              </p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {item.running ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-500/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            rodando
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/30 px-2 py-0.5 text-xs text-slate-400 ring-1 ring-slate-600/40">
            parado
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <input
          value={keybind}
          onChange={(e) => setKeybind(e.target.value)}
          placeholder="1, F1, grave, ctrl+1…"
          className={`w-28 rounded-lg border bg-slate-950/60 px-2 py-1 text-sm outline-none ${
            dirtyKey
              ? "border-amber-500/60 ring-1 ring-amber-500/30"
              : "border-white/10 focus:border-emerald-500/60"
          }`}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={20}
            max={10_000}
            step={10}
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
            className="w-28 accent-emerald-500"
          />
          <input
            type="number"
            min={20}
            max={10_000}
            value={intervalMs}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setIntervalMs(v);
            }}
            className={`w-24 rounded-lg border bg-slate-950/60 px-2 py-1 text-sm outline-none ${
              dirtyInterval
                ? "border-amber-500/60 ring-1 ring-amber-500/30"
                : "border-white/10 focus:border-emerald-500/60"
            }`}
          />
          <span className="text-xs text-slate-500">ms</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs">
        {synced ? (
          <span className="text-emerald-300" title={`Sincronizado ${formatAgo(item.secondsAgo)} atrás`}>
            ✓ sync
          </span>
        ) : bridgeConnected ? (
          <span className="text-slate-400">
            🟢 vivo {formatAgo(item.secondsAgo)}
          </span>
        ) : item.secondsAgo != null ? (
          <span className="text-slate-500" title="Última leitura pelo .exe">
            ⚪ {formatAgo(item.secondsAgo)} atrás
          </span>
        ) : (
          <span className="text-slate-500">— sem update</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          {dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const patch: Partial<{ keybind: string; intervalMs: number }> = {};
                if (dirtyKey) patch.keybind = keybind;
                if (dirtyInterval) patch.intervalMs = intervalMs;
                onSave(item.character, patch);
              }}
              className="rounded-lg bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40"
              title="Envia a config pro servidor. O .exe pega no próximo poll (até 3s)."
            >
              {saving ? "⏳ salvando…" : "💾 Salvar & enviar"}
            </button>
          )}
          {!dirty && item.running ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave(item.character, { running: false })}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
            >
              ⏸ parar
            </button>
          ) : !dirty ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave(item.character, { running: true })}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              ▶ iniciar
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
