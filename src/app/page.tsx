"use client";

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";

type Conversation = {
  character: string;
  player: string;
  lastAt: string;
  lastBody: string;
  lastDirection: "incoming" | "outgoing";
  incomingCount: number;
  totalCount: number;
};

type ChatMessage = {
  id: number;
  character: string;
  player: string;
  direction: "incoming" | "outgoing";
  body: string;
  status: string;
  createdAt: string;
};

export default function HomePage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [newCharacter, setNewCharacter] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [lastSeenId, setLastSeenId] = useState(0);

  // Poll conversations
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/conversations", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { conversations: Conversation[] };
          setConversations(data.conversations);
        }
      } catch {
        // ignore
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  // Poll notifications
  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/incoming/recent?since=${lastSeenId}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as {
            messages: ChatMessage[];
            latestId: number;
          };
          if (data.latestId > lastSeenId) setLastSeenId(data.latestId);
        }
      } catch {
        // ignore
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [lastSeenId]);

  // Load history for active conversation
  useEffect(() => {
    if (!active) return;
    const loadHistory = async () => {
      try {
        const res = await fetch(
          `/api/conversations/${encodeURIComponent(
            active.character,
          )}/${encodeURIComponent(active.player)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as { messages: ChatMessage[] };
          setMessages(data.messages);
        }
      } catch {
        // ignore
      }
    };
    loadHistory();
    const t = setInterval(loadHistory, 2500);
    return () => clearInterval(t);
  }, [active]);

  const sendReply = async () => {
    if (!active || !draft.trim() || sending) return;
    const body = draft.trim();
    setDraft("");
    setSending(true);
    try {
      await fetch(
        `/api/conversations/${encodeURIComponent(
          active.character,
        )}/${encodeURIComponent(active.player)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
    } finally {
      setSending(false);
    }
  };

  const startNewConversation = async () => {
    if (!newCharacter.trim() || !newPlayer.trim()) return;
    setNewCharacter("");
    setNewPlayer("");
    const char = newCharacter.trim();
    const player = newPlayer.trim();
    setActive({ character: char, player, lastAt: "", lastBody: "", lastDirection: "outgoing", incomingCount: 0, totalCount: 0 });
  };

  return (
    <Layout>
      <aside className="flex w-full flex-col border-r border-slate-800 bg-slate-900/40 md:w-80 lg:w-96">
        {/* New conversation */}
        <div className="border-b border-slate-800 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
            Nova conversa
          </div>
          <div className="flex flex-col gap-2">
            <input
              placeholder="Seu personagem (ex: Aragorn-Nemesis)"
              value={newCharacter}
              onChange={(e) => setNewCharacter(e.target.value)}
              list="known-chars"
              className="rounded bg-slate-800 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
            />
            <datalist id="known-chars">
              {conversations.map((c) => (
                <option key={c.character} value={c.character} />
              ))}
            </datalist>
            <div className="flex gap-2">
              <input
                placeholder="Whisper para: Nome-Reino"
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startNewConversation();
                }}
                className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
              />
              <button
                type="button"
                onClick={startNewConversation}
                className="rounded bg-amber-600 px-3 text-sm font-semibold text-slate-900 hover:bg-amber-500"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              Nenhuma conversa.<br />
              Aguarde um whisper ou inicie um novo acima.
            </div>
          ) : (
            <ul>
              {conversations.map((c) => {
                const isActive =
                  active?.player === c.player && active?.character === c.character;
                return (
                  <li key={`${c.character}-${c.player}`}>
                    <button
                      type="button"
                      onClick={() => setActive(c)}
                      className={`flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition ${
                        isActive
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-transparent hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold text-white">
                        {c.player.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-100">
                            {c.player}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-500">
                            {new Date(c.lastAt).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="mt-1 flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-slate-400">
                            {c.lastDirection === "outgoing" && "Você: "}
                            {c.lastBody}
                          </span>
                          {c.incomingCount > 0 && (
                            <span className="shrink-0 inline-flex items-center justify-center min-w-5 rounded-full bg-amber-500 text-[10px] font-bold text-slate-950 px-1">
                              {c.incomingCount}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                          {c.character}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <main
        className={`${
          active ? "flex" : "hidden md:flex"
        } flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(120,80,20,0.15),transparent_60%)]`}
      >
        {active ? (
          <>
            {/* Chat header */}
            <header className="border-b border-slate-800 bg-slate-900/60 px-4 py-3">
              <button
                type="button"
                onClick={() => setActive(null)}
                className="mb-2 rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 md:hidden"
              >
                ← Voltar
              </button>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-xs font-bold text-white">
                    {active.player.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {active.player}
                    </p>
                    <p className="text-xs text-slate-500">{active.character}</p>
                  </div>
                </div>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-400">
                  {messages.length} mensagens
                </span>
              </div>
            </header>

            {/* Messages */}
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.map((m) => {
                const mine = m.direction === "outgoing";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-xs rounded-lg px-3.5 py-2 text-sm shadow ${
                        mine
                          ? "rounded-br-none bg-amber-600/80 text-slate-900"
                          : "rounded-bl-none bg-slate-700 text-slate-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <div className="mt-1 text-[10px] opacity-70">
                        {new Date(m.createdAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        {mine && (
                          <span>
                            {m.status === "pending"
                              ? "⏳"
                              : m.status === "failed"
                                ? "⚠️"
                                : "✓"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {messages.length === 0 && (
                <p className="mt-10 text-center text-sm text-slate-500">
                  Sem mensagens nesta conversa ainda.
                </p>
              )}
            </div>

            {/* Composer */}
            <footer className="border-t border-slate-800 bg-slate-900/60 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendReply();
                }}
                className="flex items-end gap-2"
              >
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
                  placeholder="Digite a resposta..."
                  className="max-h-32 flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-lg text-slate-900 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ➤
                </button>
              </form>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-slate-500">
            <div className="text-6xl">💬</div>
            <div>Selecione uma conversa</div>
            <div className="text-xs">
              ou aguarde um whisper chegar em qualquer uma das suas janelas.
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
}
