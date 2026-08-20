"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";

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
  const [online, setOnline] = useState(0);
  const [chars, setChars] = useState(0);
  const [connected, setConnected] = useState(false);

  // --- Scroll fix: track whether user is near the bottom ---
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // Track previous message count to detect new messages
  const prevMsgCountRef = useRef(0);
  // Track if this is first load of a conversation
  const isFirstLoadRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = chatContainerRef.current;
    if (el) {
      // Use setTimeout to allow DOM to fully render the new messages before measuring scrollHeight
      setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 50);
    }
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    // Consider "near bottom" if within 80px of the bottom
    const threshold = 80;
    // We add 1 to clientHeight to account for sub-pixel rounding
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop <= el.clientHeight + threshold;
  }, []);

  useEffect(() => {
    const tick = async () => {
      try {
        const [convRes, charRes, winRes] = await Promise.all([
          fetch("/api/conversations", { cache: "no-store" }),
          fetch("/api/characters", { cache: "no-store" }),
          fetch("/api/status", { cache: "no-store" }),
        ]);
        setConnected(convRes.ok && charRes.ok && winRes.ok);
        if (convRes.ok) {
          const data = (await convRes.json()) as { conversations: Conversation[] };
          setConversations(data.conversations);
        }
        if (charRes.ok) {
          const data = (await charRes.json()) as { characters: unknown[] };
          setChars(data.characters.length);
        }
        if (winRes.ok) {
          const data = (await winRes.json()) as { windows: Array<{ lastSeen: string }> };
          const now = Date.now();
          setOnline(
            data.windows.filter((w) => now - new Date(w.lastSeen).getTime() < 15000).length,
          );
        }
      } catch {
        setConnected(false);
      }
    };
    void tick();
    const t = window.setInterval(tick, 3000);
    return () => window.clearInterval(t);
  }, []);

  // When active conversation changes, reset scroll tracking
  useEffect(() => {
    if (active) {
      isFirstLoadRef.current = true;
      prevMsgCountRef.current = 0;
      isNearBottomRef.current = true;
      // Also scroll down immediately when the user clicks a conversation,
      // even if there are no new messages loaded yet.
      scrollToBottom();
    }
  }, [active, scrollToBottom]);

  useEffect(() => {
    if (!active) return;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/conversations/${encodeURIComponent(active.character)}/${encodeURIComponent(active.player)}`,
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
    void load();
    const t = window.setInterval(load, 2500);
    return () => window.clearInterval(t);
  }, [active]);

  // Smart scroll: only auto-scroll when user is near bottom or on first load / new messages
  useEffect(() => {
    if (messages.length === 0) return;

    const isFirstLoad = isFirstLoadRef.current;
    const hasNewMessages = messages.length > prevMsgCountRef.current;

    if (isFirstLoad) {
      isFirstLoadRef.current = false;
      scrollToBottom();
    } else if (hasNewMessages) {
      if (isNearBottomRef.current) {
        scrollToBottom();
      }
    }
    // If user scrolled up (not near bottom), do NOT auto-scroll

    prevMsgCountRef.current = messages.length;
  }, [messages, scrollToBottom]);

  const startNewConversation = () => {
    const character = newCharacter.trim();
    const player = newPlayer.trim();
    if (!character || !player) return;
    setActive({
      character,
      player,
      lastAt: new Date().toISOString(),
      lastBody: "",
      lastDirection: "outgoing",
      incomingCount: 0,
      totalCount: 0,
    });
    setNewPlayer("");
  };

  const sendReply = async () => {
    if (!active || !draft.trim() || sending) return;
    const body = draft.trim();
    setDraft("");
    setSending(true);
    // After sending, user wants to see the sent message
    isNearBottomRef.current = true;
    try {
      await fetch(
        `/api/conversations/${encodeURIComponent(active.character)}/${encodeURIComponent(active.player)}`,
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

  const clearActiveConversation = async () => {
    if (!active) return;
    const ok = window.confirm(`Apagar conversa com ${active.player}?`);
    if (!ok) return;
    await fetch(
      `/api/conversations/${encodeURIComponent(active.character)}/${encodeURIComponent(active.player)}`,
      { method: "DELETE" },
    );
    setConversations((prev) =>
      prev.filter((c) => !(c.character === active.character && c.player === active.player)),
    );
    setMessages([]);
    setActive(null);
  };

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="relative flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2.5 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-500 to-amber-700 font-black text-slate-900 shadow sm:h-9 sm:w-9">
            🥐
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg">
              Bakers Whisper
            </h1>
            <p className="truncate text-[11px] text-slate-400 sm:text-xs">
              <span className="mr-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-500/60 align-middle" />{" "}
                {online} janela(s) online
              </span>
              · {chars} personagens · {conversations.length} conversas
            </p>
          </div>
        </div>
        <nav className="order-last -mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 text-xs md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0 md:pb-0">
          <Link href="/" className="whitespace-nowrap rounded border border-amber-500 bg-amber-500/10 px-2.5 py-1 text-amber-300 hover:bg-amber-500/20 md:px-3">💬 Chat</Link>
          <Link href="/download" className="whitespace-nowrap rounded border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-amber-300 hover:bg-amber-500/20 md:px-3">📥 Download</Link>
          <Link href="/accounts" className="whitespace-nowrap rounded border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/20 md:px-3">📡 Contas</Link>
          <Link href="/gse" className="whitespace-nowrap rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2.5 py-1 text-fuchsia-300 hover:bg-fuchsia-500/20 md:px-3">⚙ GSE</Link>
          <Link href="/settings" className="whitespace-nowrap rounded border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 text-sky-300 hover:bg-sky-500/20 md:px-3">🔐 Config</Link>
          <Link href="/diagnostics" className="whitespace-nowrap rounded border border-cyan-500/50 bg-cyan-500/10 px-2.5 py-1 text-cyan-300 hover:bg-cyan-500/20 md:px-3">🧪 Diagnóstico</Link>
          <Link href="/setup" className="whitespace-nowrap rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800 md:px-3">Setup</Link>
        </nav>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <div className="relative">
            <button className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-amber-300 transition" title="Preferências de notificação">
              🔔
            </button>
          </div>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-500"}`} />
          <span className="hidden text-slate-400 sm:inline">
            {connected ? "conectado" : "conectando..."}
          </span>
        </div>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-800 bg-slate-900/50 px-3 py-2 text-xs sm:px-4">
        <button className="whitespace-nowrap rounded-full border border-amber-500 bg-amber-500/10 px-3 py-1 text-amber-300 transition">
          Todos ({conversations.length})
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-r border-slate-800 bg-slate-900/40 md:w-80 lg:w-96`}>
          <div className="border-b border-slate-800 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Nova conversa
            </div>
            <div className="flex flex-col gap-2">
              <input
                placeholder="Seu personagem (ex: Aragorn-Nemesis)"
                list="known-chars"
                className="rounded bg-slate-800 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
                value={newCharacter}
                onChange={(e) => setNewCharacter(e.target.value)}
              />
              <datalist id="known-chars">
                {[...new Set(conversations.map((c) => c.character))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <div className="flex gap-2">
                <input
                  placeholder="Whisper para: Nome-Reino"
                  className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
                  value={newPlayer}
                  onChange={(e) => setNewPlayer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startNewConversation();
                  }}
                />
                <button
                  className="rounded bg-amber-600 px-3 text-sm font-semibold text-slate-900 hover:bg-amber-500"
                  onClick={startNewConversation}
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                Nenhuma conversa .<br />Aguarde um whisper ou inicie um novo acima.
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={`${c.character}:${c.player}`}
                  className={`block w-full border-l-2 px-3 py-3 text-left hover:bg-slate-800/60 ${active?.character === c.character && active?.player === c.player ? "border-amber-500 bg-amber-500/10" : "border-transparent"}`}
                  onClick={() => setActive(c)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-semibold text-slate-100">{c.player}</div>
                    <div className="text-[10px] text-slate-500">{new Date(c.lastAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">{c.lastDirection === "outgoing" ? "Você: " : ""}{c.lastBody}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{c.character}</div>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className={`${active ? "flex" : "hidden md:flex"} flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(120,80,20,0.15),transparent_60%)]`}>
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-slate-500">
              <div className="text-6xl">💬</div>
              <div>Selecione uma conversa</div>
              <div className="text-xs">ou aguarde um whisper chegar em qualquer uma das suas janelas.</div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-3">
                <div>
                  <button onClick={() => setActive(null)} className="mb-2 rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 md:hidden">← Voltar</button>
                  <div className="text-sm font-bold text-slate-100">{active.player}</div>
                  <div className="text-xs text-slate-500">{active.character}</div>
                </div>
                <button
                  type="button"
                  onClick={clearActiveConversation}
                  className="rounded border border-rose-500/60 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
                  title="Apagar conversa"
                >
                  🗑 Limpar
                </button>
              </div>
              {/* Chat messages area — scroll fix applied here */}
              <div
                ref={chatContainerRef}
                onScroll={handleChatScroll}
                className="flex-1 space-y-2 overflow-y-auto p-4"
              >
                {messages.length === 0 ? (
                  <div className="pt-10 text-center text-sm text-slate-500">Sem mensagens nesta conversa ainda.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.direction === "outgoing" ? "bg-amber-600 text-slate-950" : "bg-slate-800 text-slate-100"}`}>
                        <div>{m.body}</div>
                        <div className="mt-1 text-[10px] opacity-70">{new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form
                className="flex gap-2 border-t border-slate-800 bg-slate-900/60 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendReply();
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Digite a resposta..."
                  className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                />
                <button disabled={!draft.trim() || sending} className="rounded bg-amber-600 px-4 text-sm font-bold text-slate-950 disabled:opacity-40">Enviar</button>
              </form>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
