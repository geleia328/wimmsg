"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotifications } from "./useNotifications";

type Conversation = {
  character: string;
  player: string;
  lastAt: string;
  lastBody: string;
  lastDirection: "incoming" | "outgoing";
  incomingCount: number;
  pendingOut: number;
  totalCount: number;
};

type CharacterInfo = {
  character: string;
  total: number;
  incoming: number;
  pendingOut: number;
  lastAt: string | null;
};

type WindowStatus = {
  character: string;
  windowTitle: string;
  online: boolean;
  onlineByScan?: boolean;
  onlineByActivity?: boolean;
  secondsAgo: number;
  secondsSinceIncoming?: number | null;
  foreground: boolean;
  matched: boolean;
  slot: string;
  realm: string;
};

type Message = {
  id: number;
  character: string;
  player: string;
  direction: "incoming" | "outgoing";
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

const ALL = "__ALL__";
const POLL_LIST_MS = 3000;
const POLL_CHAT_MS = 1500;
const POLL_INCOMING_MS = 2000;
const DEMO_TICK_MS = 4000;

function titleCase(value: string) {
  if (!value) return value;
  const [name] = value.split("-");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function realmOf(value: string) {
  if (!value) return "";
  const idx = value.lastIndexOf("-");
  if (idx < 0) return "";
  return value.slice(idx + 1);
}

function realmMismatchWarning(
  player: string,
  character: string,
): string | null {
  const a = realmOf(player);
  const b = realmOf(character);
  if (!a || !b) return null;
  if (a.toLowerCase() === b.toLowerCase()) return null;
  return `Servidor diferente: seu personagem está em ${b} mas o destinatário está em ${a}. A mensagem pode falhar se os servidores não estiverem conectados.`;
}

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard
    .writeText(value)
    .then(() => {
      // Feedback visual simples via toast se a função estiver disponível
      window.dispatchEvent(
        new CustomEvent("bw:toast", { detail: `📋 copiado: ${value}` }),
      );
    })
    .catch(() => {
      /* silencioso */
    });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Date.now() - d;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatRelative(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function charColor(name: string): string {
  const palette = [
    "bg-sky-500/20 text-sky-300 border-sky-500/40",
    "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40",
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    "bg-orange-500/20 text-orange-300 border-orange-500/40",
    "bg-lime-500/20 text-lime-300 border-lime-500/40",
    "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
    "bg-pink-500/20 text-pink-300 border-pink-500/40",
    "bg-violet-500/20 text-violet-300 border-violet-500/40",
    "bg-teal-500/20 text-teal-300 border-teal-500/40",
    "bg-rose-500/20 text-rose-300 border-rose-500/40",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function statusTick(status: string): string {
  if (status === "pending") return "🕓";
  if (status === "sent") return "✓✓";
  if (status === "failed") return "⚠";
  return "";
}

export function ChatApp() {
  const notif = useNotifications();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [windows, setWindows] = useState<WindowStatus[]>([]);
  const [serverUp, setServerUp] = useState(true);
  const [filter, setFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ character: string; player: string } | null>(
    null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const readRef = useRef<Record<string, string>>({});
  const lastIncomingIdRef = useRef<number>(-1);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seededRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  // Ouve eventos globais de toast (disparado pelo copyToClipboard, por ex.)
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") showToast(detail);
    };
    window.addEventListener("bw:toast", onToast as EventListener);
    return () => window.removeEventListener("bw:toast", onToast as EventListener);
  }, [showToast]);

  const refreshTop = useCallback(async () => {
    try {
      const [convRes, charRes, statusRes] = await Promise.all([
        fetch("/api/conversations", { cache: "no-store" }),
        fetch("/api/characters", { cache: "no-store" }),
        fetch("/api/status", { cache: "no-store" }),
      ]);
      const convData = (await convRes.json()) as { conversations: Conversation[] };
      const charData = (await charRes.json()) as { characters: CharacterInfo[] };
      const statusData = (await statusRes.json()) as {
        windows: WindowStatus[];
      };
      setConversations(convData.conversations ?? []);
      setCharacters(charData.characters ?? []);
      setWindows(statusData.windows ?? []);
      setServerUp(true);
    } catch {
      setServerUp(false);
    }
  }, []);

  const loadMessages = useCallback(async (charA: string, charB: string) => {
    try {
      const res = await fetch(
        `/api/conversations/bidirectional?charA=${encodeURIComponent(charA)}&charB=${encodeURIComponent(charB)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages ?? []);
    } catch {
      /* mantém o último estado bom; o próximo poll tenta de novo */
    }
  }, []);

  // Seed de demonstração (só se o banco estiver vazio).
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    void (async () => {
      try {
        await fetch("/api/bridge-sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "seed" }),
        });
        await refreshTop();
      } catch {
        /* silencioso */
      }
    })();
  }, [refreshTop]);

  useEffect(() => {
    void refreshTop();
    const id = window.setInterval(() => void refreshTop(), POLL_LIST_MS);
    return () => window.clearInterval(id);
  }, [refreshTop]);

  // Notificações de novos sussurros (mesmo em conversas fechadas).
  useEffect(() => {
    if (!notif.ready) return;
    const tick = async () => {
      try {
        const since = lastIncomingIdRef.current;
        const url =
          since < 0 ? "/api/incoming/recent" : `/api/incoming/recent?since=${since}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = (await res.json()) as {
          messages: Array<{
            id: number;
            character: string;
            player: string;
            body: string;
          }>;
          latestId: number;
        };
        if (lastIncomingIdRef.current < 0) {
          lastIncomingIdRef.current = data.latestId ?? 0;
          return;
        }
        const fresh = (data.messages ?? []).filter(
          (m) => m.id > lastIncomingIdRef.current,
        );
        lastIncomingIdRef.current = data.latestId ?? lastIncomingIdRef.current;
        for (const m of fresh) {
          notif.notify(`${titleCase(m.player)} → ${titleCase(m.character)}`, m.body);
        }
        if (fresh.length > 0) void refreshTop();
      } catch {
        /* silencioso */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_INCOMING_MS);
    return () => window.clearInterval(id);
  }, [notif, refreshTop]);

  // Conversa aberta
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    void loadMessages(selected.character, selected.player);
    const id = window.setInterval(
      () => void loadMessages(selected.character, selected.player),
      POLL_CHAT_MS,
    );
    return () => window.clearInterval(id);
  }, [selected, loadMessages]);

  // Modo demonstração: simula o bridge entregando a fila e mandando sussurros.
  useEffect(() => {
    if (!demo) return;
    const id = window.setInterval(async () => {
      try {
        await fetch("/api/bridge-sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "tick" }),
        });
        if (selected) void loadMessages(selected.character, selected.player);
        void refreshTop();
      } catch {
        /* silencioso */
      }
    }, DEMO_TICK_MS);
    return () => window.clearInterval(id);
  }, [demo, selected, loadMessages, refreshTop]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!selected) return;
    readRef.current[`${selected.character}:${selected.player}`] = new Date().toISOString();
  }, [selected, messages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter !== ALL && c.character !== filter) return false;
      if (!q) return true;
      return (
        c.player.toLowerCase().includes(q) ||
        c.character.toLowerCase().includes(q) ||
        c.lastBody.toLowerCase().includes(q)
      );
    });
  }, [conversations, filter, search]);

  const onlineCount = windows.filter((w) => w.online).length;
  const totalIncoming = characters.reduce((acc, c) => acc + c.incoming, 0);
  const totalPending = characters.reduce((acc, c) => acc + c.pendingOut, 0);

  const isUnread = (c: Conversation) =>
    c.lastDirection === "incoming" &&
    readRef.current[`${c.character}:${c.player}`] !== c.lastAt;

  const sendReply = useCallback(async () => {
    if (!selected || !draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(selected.character)}/${encodeURIComponent(selected.player)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: draft.trim() }),
        },
      );
      const data = (await res.json()) as { warning?: string; error?: string };
      if (res.ok) {
        if (data.warning) showToast(`⚠️ ${data.warning}`);
        const inline = realmMismatchWarning(selected.player, selected.character);
        if (inline) {
          // warning do backend + heurística local (mesma comparação case-insensitive)
        }
        setDraft("");
        void loadMessages(selected.character, selected.player);
        void refreshTop();
      } else {
        showToast(`❌ ${data.error ?? "erro ao enfileirar mensagem"}`);
      }
    } finally {
      setSending(false);
    }
  }, [selected, draft, loadMessages, refreshTop, showToast]);

  const deleteMessage = useCallback(
    async (id: number) => {
      await fetch(`/api/messages/${id}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((m) => m.id !== id));
      void refreshTop();
    },
    [refreshTop],
  );

  const clearConversation = useCallback(async () => {
    if (!selected) return;
    if (!window.confirm("Apagar toda a conversa? As pendentes saem da fila.")) return;
    await fetch(
      `/api/conversations/${encodeURIComponent(selected.character)}/${encodeURIComponent(selected.player)}`,
      { method: "DELETE" },
    );
    setMessages([]);
    setSelected(null);
    void refreshTop();
  }, [selected, refreshTop]);

  return (
    <div className="grid h-[calc(100vh-9.5rem)] grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      {/* Sidebar */}
      <aside className="bw-scroll flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
        <div className="border-b border-white/10 p-3">
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar jogador ou mensagem…"
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-500/60"
            />
            <button
              type="button"
              onClick={() => {
                notif.toggleEnabled();
                if (!notif.enabled) {
                  void notif.requestPermission();
                }
              }}
              title={
                notif.permission === "default"
                  ? "Ativar som + notificações do navegador"
                  : notif.enabled
                    ? "Silenciar som"
                    : "Ativar som"
              }
              className="rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-2 text-sm hover:bg-white/10"
            >
              {notif.enabled ? "🔔" : "🔕"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilter(ALL)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                filter === ALL
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              Todas ({conversations.length})
            </button>
            {characters.map((c) => (
              <button
                key={c.character}
                type="button"
                onClick={() => setFilter(c.character)}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  filter === c.character
                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {titleCase(c.character)}
                {c.pendingOut > 0 ? ` •${c.pendingOut}` : ""}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {serverUp ? "🟢 servidor ok" : "🔴 servidor offline"} · 🪟 {onlineCount}{" "}
              janelas · 📨 {totalIncoming} · 🕓 {totalPending}
            </span>
            <button
              type="button"
              onClick={() => setDemo((v) => !v)}
              className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                demo
                  ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {demo ? "⏸ modo demo" : "▶ modo demo"}
            </button>
          </div>
        </div>

        <div className="bw-scroll min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              Nenhuma conversa ainda. Ligue o <b>modo demo</b> ou suba o bridge
              Python do seu PC.
            </p>
          ) : (
              filtered.map((c) => {
              const key = `${c.character}:${c.player}`;
              const active =
                selected?.character === c.character && selected?.player === c.player;
              return (
                <div
                  key={key}
                  className={`group flex w-full items-stretch gap-0 border-b border-white/5 transition ${
                    active ? "bg-emerald-500/10" : "hover:bg-white/5"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelected({ character: c.character, player: c.player })}
                    className="flex min-w-0 flex-1 gap-3 px-3 py-2.5 text-left"
                  >
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-semibold uppercase ${charColor(c.player)}`}
                  >
                    {c.player.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">
                        {titleCase(c.player)}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                        {timeAgo(c.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span
                        className={`inline-block max-w-[8rem] truncate rounded px-1.5 py-0.5 text-[10px] ${charColor(c.character)}`}
                      >
                        {titleCase(c.character)}
                        {realmOf(c.character) ? ` · ${realmOf(c.character)}` : ""}
                      </span>
                      {c.pendingOut > 0 ? (
                        <span className="text-[10px] text-amber-300">
                          🕓 {c.pendingOut}
                        </span>
                      ) : null}
                      {isUnread(c) && !active ? (
                        <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {c.lastDirection === "outgoing" ? "✓✓ " : ""}
                      {c.lastBody}
                    </span>
                  </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(c.player);
                    }}
                    title={`Copiar "${c.player}"`}
                    className="self-start px-2 py-2 text-xs text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-sky-300"
                  >
                    📋
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Conversa */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
        {!selected ? (
          <div className="grid flex-1 place-items-center p-10 text-center">
            <div className="max-w-md">
              <div className="text-5xl">🥐</div>
              <h1 className="mt-4 text-2xl font-semibold">Bakers Whisper</h1>
              <p className="mt-2 text-sm text-slate-400">
                Selecione uma conversa à esquerda para responder. As respostas entram
                na fila e o bridge Python digita no jogo automaticamente.
              </p>
              <p className="mt-4 text-xs text-slate-500">
                Este preview roda com um bridge simulado (modo demo). Para usar de
                verdade, veja a página{" "}
                <a className="text-emerald-400 underline" href="/setup">
                  Setup / Bridge
                </a>
                .
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <span
                className={`grid h-10 w-10 place-items-center rounded-full border text-sm font-semibold uppercase ${charColor(selected.player)}`}
              >
                {selected.player.slice(0, 2)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {titleCase(selected.player)}
                  {realmOf(selected.player) ? (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {realmOf(selected.player)}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-slate-400">
                  via {titleCase(selected.character)}
                  {realmOf(selected.character)
                    ? ` (${realmOf(selected.character)})`
                    : ""}{" "}
                  ·{" "}
                  {(() => {
                    const w = windows.find(
                      (x) => x.character === selected.character,
                    );
                    if (!w) return "janela desconhecida";
                    if (w.onlineByScan) {
                      return w.foreground ? "🟢 online · em foco" : "🟢 online";
                    }
                    if (w.onlineByActivity) {
                      return `🟡 ativo (último whisper há ${formatRelative(w.secondsSinceIncoming)})`;
                    }
                    return "⚪ offline";
                  })()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(selected.player)}
                title="Copiar Nome-Servidor para a área de transferência"
                className="ml-auto rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-sky-500/10 hover:text-sky-300"
              >
                📋 Copiar
              </button>
              <button
                type="button"
                onClick={() => void clearConversation()}
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-rose-500/10 hover:text-rose-300"
              >
                🗑 limpar
              </button>
            </header>

            {(() => {
              const warn = realmMismatchWarning(selected.player, selected.character);
              if (!warn) return null;
              return (
                <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                  ⚠ <b>Servidor diferente</b>: {warn}
                </div>
              );
            })()}

            <div className="bw-scroll min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(800px_400px_at_50%_0%,rgba(16,185,129,0.06),transparent)] p-4">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-slate-500">
                  Nenhuma mensagem ainda.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((m) => {
                    const outgoing = m.direction === "outgoing";
                    return (
                      <div
                        key={m.id}
                        className={`group flex ${outgoing ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`bw-in max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                            outgoing
                              ? "bg-emerald-600/25 text-emerald-50 ring-1 ring-emerald-500/30"
                              : "bg-slate-800/70 text-slate-100 ring-1 ring-white/10"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-slate-400">
                            {!outgoing ? (
                              <span className="opacity-70">
                                {titleCase(m.player)} → {titleCase(m.character)}
                              </span>
                            ) : (
                              <span
                                className={
                                  m.status === "failed" ? "text-rose-400" : ""
                                }
                                title={m.error ?? ""}
                              >
                                {statusTick(m.status)}{" "}
                                {m.status === "pending"
                                  ? "na fila"
                                  : m.status === "failed"
                                    ? "falhou"
                                    : "enviado"}
                              </span>
                            )}
                            <span>{clockOf(m.createdAt)}</span>
                            <button
                              type="button"
                              onClick={() => void deleteMessage(m.id)}
                              className="opacity-0 transition group-hover:opacity-100 hover:text-rose-300"
                              title="Apagar mensagem"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <footer className="border-t border-white/10 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendReply();
                    }
                  }}
                  rows={1}
                  maxLength={255}
                  placeholder={`Responder ${titleCase(selected.player)} como ${titleCase(selected.character)}…`}
                  className="bw-scroll max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-500/60"
                />
                <button
                  type="button"
                  onClick={() => void sendReply()}
                  disabled={sending || !draft.trim()}
                  className="h-[42px] rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Enviar
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Enter envia · Shift+Enter quebra linha · a mensagem fica
                &ldquo;na fila&rdquo; até o bridge confirmar o envio no jogo.
              </p>
            </footer>
          </>
        )}
      </section>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
