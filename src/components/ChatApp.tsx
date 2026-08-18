"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotifications } from "./useNotifications";

type Conversation = {
  character: string;
  player: string;
  lastAt: string;
  lastBody: string;
  lastDirection: string;
  incomingCount: number;
  totalCount: number;
};

type Msg = {
  id: number;
  body: string;
  status: string;
  createdAt: string;
  direction: "incoming" | "outgoing";
};

const POLL_MS = 1000;
const CHAT_POLL_MS = 500;

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function convKey(c: string, p: string): string {
  return `${c.toLowerCase()}::${p.toLowerCase()}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "hoje";
    if (d.toDateString() === yesterday.toDateString()) return "ontem";
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(true);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [readAt, setReadAt] = useState<Record<string, number>>({});
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChar, setNewChar] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [characters, setCharacters] = useState<{ character: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastIncomingCheck = useRef<number>(Date.now());
  const { permission, request, notify, ttsEnabled, setTts, speak } = useNotifications();

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations", { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) {
        setConversations(j.conversations || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadCharacters = useCallback(async () => {
    try {
      const r = await fetch("/api/characters", { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) setCharacters(j.characters || []);
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (conv: Conversation) => {
    try {
      const url = `/api/conversations/bidirectional?charA=${encodeURIComponent(conv.character)}&charB=${encodeURIComponent(conv.player)}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) {
        setMessages(j.messages || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadConversations();
    loadCharacters();
    const t = setInterval(() => {
      loadConversations();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [loadConversations, loadCharacters]);

  useEffect(() => {
    if (!selected) return;
    loadMessages(selected);
    const t = setInterval(() => {
      loadMessages(selected);
    }, CHAT_POLL_MS);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  useEffect(() => {
    // scroll to bottom on messages change
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, selected?.character, selected?.player]);

  // Compute unread badges when conversations update
  useEffect(() => {
    setUnread((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const c of conversations) {
        const key = convKey(c.character, c.player);
        const rAt = readAt[key] || 0;
        const lastMs = new Date(c.lastAt).getTime();
        // If selected, mark read
        if (selected && sameName(selected.character, c.character) && sameName(selected.player, c.player)) {
          next[key] = 0;
          continue;
        }
        if (c.lastDirection === "incoming" && lastMs > rAt) {
          next[key] = c.incomingCount;
        } else if (!next[key]) {
          next[key] = 0;
        }
      }
      return next;
    });
  }, [conversations, selected, readAt]);

  // Notifications on new incoming
  useEffect(() => {
    let cancel = false;
    async function tick() {
      try {
        const since = lastIncomingCheck.current;
        const r = await fetch(`/api/incoming/recent?sinceMs=${since}`, { cache: "no-store" });
        const j = await r.json();
        if (cancel) return;
        if (j?.ok && Array.isArray(j.messages)) {
          for (const m of j.messages as Array<{ character: string; player: string; body: string; createdAt: string }>) {
            const t = new Date(m.createdAt).getTime();
            if (t > lastIncomingCheck.current) lastIncomingCheck.current = t;
            const isOpen = selected && sameName(selected.character, m.character) && sameName(selected.player, m.player);
            if (!isOpen) {
              notify(`${m.player} → ${m.character}`, m.body);
            }
            // ler em voz alta se TTS ligado (funciona também com chat aberto)
            speak(`${m.player} para ${m.character}: ${m.body}`);
          }
        }
      } catch { /* ignore */ }
    }
    const t = setInterval(tick, 2000);
    return () => { cancel = true; clearInterval(t); };
  }, [selected, notify]);

  const openConversation = useCallback((c: Conversation) => {
    setSelected(c);
    setShowList(false);
    setReadAt((prev) => ({ ...prev, [convKey(c.character, c.player)]: Date.now() }));
    setUnread((prev) => ({ ...prev, [convKey(c.character, c.player)]: 0 }));
    setMessages([]);
  }, []);

  const backToList = useCallback(() => {
    setShowList(true);
  }, []);

  const send = useCallback(async () => {
    if (!selected || !draft.trim() || sending) return;
    const body = draft.trim();
    setSending(true);
    setDraft("");
    // Optimistic
    setMessages((prev) => [
      ...prev,
      {
        id: -Date.now(),
        body,
        status: "pending",
        createdAt: new Date().toISOString(),
        direction: "outgoing",
      },
    ]);
    try {
      await fetch(
        `/api/conversations/${encodeURIComponent(selected.character)}/${encodeURIComponent(selected.player)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      await loadMessages(selected);
      await loadConversations();
    } catch { /* ignore */ }
    setSending(false);
  }, [selected, draft, sending, loadMessages, loadConversations]);

  const clearConv = useCallback(async () => {
    if (!selected) return;
    if (!confirm(`Limpar conversa entre ${selected.character} e ${selected.player}?`)) return;
    try {
      await fetch(
        `/api/conversations/${encodeURIComponent(selected.character)}/${encodeURIComponent(selected.player)}`,
        { method: "DELETE" },
      );
      setMessages([]);
      await loadConversations();
    } catch { /* ignore */ }
  }, [selected, loadConversations]);

  const syncFromServer = useCallback(async () => {
    if (!selected) return;
    try {
      const url = `/api/sync?character=${encodeURIComponent(selected.character)}&player=${encodeURIComponent(selected.player)}&limit=200`;
      await fetch(url, { cache: "no-store" });
      await loadMessages(selected);
    } catch { /* ignore */ }
  }, [selected, loadMessages]);

  const startNewChat = useCallback(() => {
    const c = newChar.trim();
    const p = newPlayer.trim();
    if (!c || !p) return;
    const conv: Conversation = {
      character: c,
      player: p,
      lastAt: new Date().toISOString(),
      lastBody: "",
      lastDirection: "outgoing",
      incomingCount: 0,
      totalCount: 0,
    };
    setShowNewChat(false);
    setNewChar("");
    setNewPlayer("");
    openConversation(conv);
  }, [newChar, newPlayer, openConversation]);

  const totalUnread = useMemo(() => Object.values(unread).reduce((s, n) => s + (n > 0 ? 1 : 0), 0), [unread]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full bg-slate-950">
      {/* Sidebar */}
      <aside
        className={`${showList ? "flex" : "hidden"} md:flex flex-col w-full md:w-80 lg:w-96 border-r border-slate-800 bg-slate-900`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <span className="font-semibold">Conversas</span>
            {totalUnread > 0 && (
              <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-slate-950">
                {totalUnread}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowNewChat(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
          >
            + Nova
          </button>
        </div>
        <div className="flex gap-2 px-3 py-2">
          {permission === "default" && (
            <button
              onClick={request}
              className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
            >
              🔔 Notificações
            </button>
          )}
          <button
            onClick={() => setTts(!ttsEnabled)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs ${
              ttsEnabled ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
            title="Ler mensagens recebidas em voz alta"
          >
            🔊 Ler em voz alta {ttsEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="scroll-y flex-1">
          {conversations.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">
              Nenhuma conversa ainda.
              <br />
              Quando alguém enviar whisper, aparecerá aqui.
            </div>
          )}
          {conversations.map((c) => {
            const key = convKey(c.character, c.player);
            const isSel = selected && sameName(selected.character, c.character) && sameName(selected.player, c.player);
            const u = unread[key] || 0;
            return (
              <button
                key={key}
                onClick={() => openConversation(c)}
                className={`flex w-full items-start gap-3 border-b border-slate-800 px-4 py-3 text-left transition hover:bg-slate-800 ${
                  isSel ? "bg-slate-800" : ""
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-sky-600 font-semibold uppercase">
                  {c.player.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-100">{c.player}</span>
                    <span className="shrink-0 text-xs text-slate-500">{formatTime(c.lastAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-400">
                      <span className="text-emerald-400">{c.character}</span> · {c.lastDirection === "outgoing" ? "você: " : ""}
                      {c.lastBody}
                    </span>
                    {u > 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-bold text-slate-950">
                        !
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chat panel */}
      <section className={`${showList ? "hidden" : "flex"} md:flex flex-1 flex-col bg-slate-950`}>
        {!selected ? (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div className="max-w-md">
              <div className="mb-4 text-6xl">🥐</div>
              <h2 className="text-2xl font-semibold text-slate-100">Bakers Whisper</h2>
              <p className="mt-2 text-slate-400">
                Selecione uma conversa à esquerda ou crie uma nova.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
              <button
                onClick={backToList}
                className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 md:hidden"
                aria-label="voltar"
              >
                ←
              </button>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-sky-600 font-semibold uppercase">
                {selected.player.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{selected.player}</div>
                <div className="truncate text-xs text-slate-400">
                  como <span className="text-emerald-400">{selected.character}</span>
                </div>
              </div>
              <button
                onClick={syncFromServer}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs hover:bg-slate-700"
                title="sincronizar histórico"
              >
                🔄 Sincronizar
              </button>
              <button
                onClick={clearConv}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs hover:bg-red-900"
                title="limpar conversa"
              >
                🗑 Limpar
              </button>
            </header>

            <div className="scroll-y flex-1 space-y-2 bg-slate-950 px-3 py-4 md:px-6">
              {messages.length === 0 && (
                <div className="grid h-full place-items-center text-sm text-slate-500">
                  Sem mensagens ainda.
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showDate = !prev || formatDate(prev.createdAt) !== formatDate(m.createdAt);
                return (
                  <div key={m.id}>
                    {showDate && (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">
                          {formatDate(m.createdAt)}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${m.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm md:max-w-[70%] ${
                          m.direction === "outgoing"
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-800 text-slate-100"
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.direction === "outgoing" ? "text-emerald-100/80" : "text-slate-400"}`}>
                          <span>{formatTime(m.createdAt)}</span>
                          {m.direction === "outgoing" && (
                            <span>
                              {m.status === "sent" ? "✓✓" : m.status === "failed" ? "⚠" : "⏱"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <footer className="border-t border-slate-800 bg-slate-900 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Escreva uma mensagem..."
                  rows={1}
                  className="max-h-40 flex-1 resize-none rounded-2xl bg-slate-800 px-4 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {showNewChat && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Nova conversa</h3>
            <p className="mt-1 text-sm text-slate-400">
              Envie whisper como um dos seus personagens para outro jogador.
            </p>
            <label className="mt-4 block">
              <span className="text-xs uppercase text-slate-400">Seu personagem</span>
              <input
                list="chars"
                value={newChar}
                onChange={(e) => setNewChar(e.target.value)}
                placeholder="ex: Juper-Azralon"
                className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <datalist id="chars">
                {characters.map((c) => (
                  <option key={c.character} value={c.character} />
                ))}
              </datalist>
            </label>
            <label className="mt-3 block">
              <span className="text-xs uppercase text-slate-400">Destinatário</span>
              <input
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
                placeholder="ex: Cbsies-Azralon"
                className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowNewChat(false)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={startNewChat}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500"
              >
                Abrir chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
