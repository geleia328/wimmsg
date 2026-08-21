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
  totalCount: number;
};

type CharacterInfo = {
  character: string;
  total: number;
  incoming: number;
  pendingOut: number;
  lastAt: string;
};

type WindowStatus = {
  character: string;
  windowTitle: string;
  online: boolean;
  foreground: boolean;
  matched: boolean;
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

// Polling cadences tuned for fluidity + low server load:
//  - incoming/notificações: 2.5s
//  - lista/contas/status:   4s
//  - conversa aberta:       2.5s
// This is responsive enough for chat while being substantially lighter on
// mobile networks and serverless database reads.
const POLL_MS = 2500;
const TOP_POLL_MS = 4000;
const INITIAL_CONVERSATION_LIMIT = 100;
const ALL = "__ALL__";

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function statusBadge(status: string): { label: string; classes: string } {
  switch (status) {
    case "pending":
      return {
        label: "aguardando envio",
        classes: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
      };
    case "sent":
      return {
        label: "enviado no jogo",
        classes:
          "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
      };
    case "failed":
      return {
        label: "falhou",
        classes: "bg-rose-500/20 text-rose-300 border border-rose-500/40",
      };
    case "received":
      return { label: "recebido", classes: "" };
    default:
      return { label: status, classes: "" };
  }
}

function realmColor(name: string): string {
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
  // Keep all characters from the same realm visually grouped.
  const realm = name.includes("-") ? name.split("-").at(-1)! : name;
  let h = 0;
  for (let i = 0; i < realm.length; i += 1) h = (h * 31 + realm.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, WindowStatus>>({});
  const [totalWindowsOnline, setTotalWindowsOnline] = useState(0);
  const [characterFilter, setCharacterFilter] = useState<string>(ALL);
  const [selected, setSelected] = useState<{
    character: string;
    player: string;
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Record<number, boolean>>({});
  const [clearingConversation, setClearingConversation] = useState(false);
  const [newCharacter, setNewCharacter] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [conversationLimit, setConversationLimit] = useState(
    INITIAL_CONVERSATION_LIMIT,
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Only auto-scroll to the newest message when the user is already near the
  // bottom. Fixes the bug where reading history was impossible because every
  // poll yanked the scrollbar back to the end.
  const stickToBottomRef = useRef(true);
  const onChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }, []);
  const scrollIfStuck = useCallback(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);
  const notif = useNotifications();
  const lastIncomingIdRef = useRef<number>(-1);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const maxMessageIdRef = useRef(0);
  // Track which conversations have unseen incoming messages
  const [unreadMap, setUnreadMap] = useState<Record<string, boolean>>({});

  const refreshTop = useCallback(async () => {
    try {
      const [c1, c2, c3] = await Promise.all([
        fetch("/api/conversations", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/characters", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/status", { cache: "no-store" }).then((r) => r.json()),
      ]);
      const rawConvos =
        (c1 as { conversations: Conversation[] }).conversations ?? [];
      const nextCharacters =
        (c2 as { characters: CharacterInfo[] }).characters ?? [];
      const wins =
        (c3 as { windows: Array<WindowStatus & { character: string }> })
          .windows ?? [];
      const map: Record<string, WindowStatus> = {};
      let onlineCount = 0;
      for (const w of wins) {
        if (w.online) onlineCount += 1;
        if (w.character) map[w.character] = w;
      }
      const knownOwnCharacters = new Set<string>([
        ...nextCharacters.map((c) => c.character),
        ...wins.map((w) => w.character).filter(Boolean),
      ]);
      const convMap = new Map<string, Conversation>();
      for (const c of rawConvos) {
        convMap.set(`${c.character}::${c.player}`, c);
        // Messenger behavior for your own characters: if the other side is
        // also one of your windows, create the mirror conversation so opening
        // taldoglaidon↔madelina shows the same chat in reverse perspective.
        if (knownOwnCharacters.has(c.player)) {
          const mirrorKey = `${c.player}::${c.character}`;
          if (!convMap.has(mirrorKey)) {
            convMap.set(mirrorKey, {
              character: c.player,
              player: c.character,
              lastAt: c.lastAt,
              lastBody: c.lastBody,
              lastDirection:
                c.lastDirection === "outgoing" ? "incoming" : "outgoing",
              incomingCount: c.lastDirection === "outgoing" ? 1 : c.incomingCount,
              totalCount: c.totalCount,
            });
          }
        }
      }
      const newConvos = Array.from(convMap.values()).sort(
        (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
      );
      setConversations(newConvos);
      setCharacters(nextCharacters);
      setStatusMap(map);
      setTotalWindowsOnline(onlineCount);
      setBridgeUp(true);
    } catch {
      setBridgeUp(false);
    }
  }, []);

  // Single source of truth for the open chat: the bidirectional endpoint
  // returns both sides (A→B and B→A) normalized — one fetch instead of two.
  const fetchBidirectionalMessages = useCallback(
    async (charA: string, charB: string) => {
      try {
        const res = await fetch(
          `/api/conversations/bidirectional?charA=${encodeURIComponent(charA)}&charB=${encodeURIComponent(charB)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages: Message[] };
        const msgs = data.messages ?? [];
        setMessages(msgs);
        for (const m of msgs) {
          if (m.id > maxMessageIdRef.current) maxMessageIdRef.current = m.id;
        }
      } catch {
        /* keep last good state — next poll retries */
      }
    },
    [],
  );

  useEffect(() => {
    void refreshTop();
    const id = setInterval(refreshTop, TOP_POLL_MS);
    return () => clearInterval(id);
  }, [refreshTop]);

  // Poll for new incoming whispers globally so we can fire notifications
  // even for conversations that aren't currently open.
  useEffect(() => {
    if (!notif.ready) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const since = lastIncomingIdRef.current;
        const url =
          since < 0
            ? "/api/incoming/recent"
            : `/api/incoming/recent?since=${since}`;
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
        if (cancelled) return;

        if (lastIncomingIdRef.current < 0) {
          lastIncomingIdRef.current = data.latestId ?? 0;
          return;
        }

        for (const m of data.messages) {
          if (m.id > lastIncomingIdRef.current) {
            notif.notifyIncoming({
              character: m.character,
              player: m.player,
              body: m.body,
            });
            lastIncomingIdRef.current = m.id;

            const sel = selectedRef.current;
            const isCurrentChat =
              sel &&
              ((sel.character === m.character && sel.player === m.player) ||
                (sel.character === m.player && sel.player === m.character));

            if (isCurrentChat && sel) {
              // Auto-refresh usando bidirecional para mostrar mensagens de ambos os lados
              await fetchBidirectionalMessages(sel.character, sel.player);
              setTimeout(scrollIfStuck, 50);
            } else {
              // Mark as unread for the conversation list badge
              const key = `${m.character}::${m.player}`;
              setUnreadMap((prev) => ({ ...prev, [key]: true }));
            }
          }
        }
      } catch {
        /* silent */
      }
    };

    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [notif, fetchBidirectionalMessages]);

  // When a conversation becomes selected, clear its unread badge
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    const key = `${selected.character}::${selected.player}`;
    setUnreadMap((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Abrir conversa sempre mostra o final; depois disso o usuário pode rolar
    // para cima livremente sem ser "puxado" de volta.
    stickToBottomRef.current = true;
    // Usar API bidirecional para mostrar conversa completa (A→B e B→A)
    void fetchBidirectionalMessages(selected.character, selected.player);
    // A lista de notificações já atualiza em paralelo; 2.5s mantém a conversa
    // fluida sem requisitar o histórico inteiro em excesso no celular.
    const id = setInterval(
      () => void fetchBidirectionalMessages(selected.character, selected.player),
      POLL_MS,
    );
    return () => clearInterval(id);
  }, [selected, fetchBidirectionalMessages]);

  useEffect(() => {
    scrollIfStuck();
  }, [messages, scrollIfStuck]);

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
      if (res.ok) {
        const data = (await res.json()) as { warning?: string };
        if (data.warning) {
          alert(`⚠ Aviso de servidor:\n\n${data.warning}`);
        }
        setDraft("");
        void fetchBidirectionalMessages(selected.character, selected.player);
        void refreshTop();
      } else {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "erro ao enfileirar mensagem");
      }
    } finally {
      setSending(false);
    }
  }, [selected, draft, fetchBidirectionalMessages, refreshTop]);

  const deleteMessage = useCallback(
    async (message: Message) => {
      if (!selected) return;
      const ok = window.confirm(
        "Apagar esta mensagem do chat?\n\n" +
          "Se ela ainda estiver pendente, também será removida da fila de envio.",
      );
      if (!ok) return;

      setDeletingIds((current) => ({ ...current, [message.id]: true }));
      try {
        const res = await fetch(`/api/messages/${message.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          alert(err.error ?? "erro ao apagar mensagem");
          return;
        }
        setMessages((prev) => prev.filter((m) => m.id !== message.id));
        void refreshTop();
      } finally {
        setDeletingIds((current) => {
          const next = { ...current };
          delete next[message.id];
          return next;
        });
      }
    },
    [selected, refreshTop],
  );

  const clearConversation = useCallback(async () => {
    if (!selected) return;
    const ok = window.confirm(
      `Apagar TODAS as mensagens entre ${selected.character} e ${selected.player}?\n\n` +
        "Isso também remove respostas pendentes dessa conversa da fila.",
    );
    if (!ok) return;

    setClearingConversation(true);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(selected.character)}/${encodeURIComponent(selected.player)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "erro ao limpar conversa");
        return;
      }
      setMessages([]);
      setConversations((prev) =>
        prev.filter(
          (c) =>
            c.character !== selected.character || c.player !== selected.player,
        ),
      );
      setSelected(null);
      void refreshTop();
    } finally {
      setClearingConversation(false);
    }
  }, [selected, refreshTop]);

  const realmMismatch = useMemo(() => {
    if (!selected) return null;
    const cr = selected.character.includes("-")
      ? selected.character.split("-").slice(-1)[0]
      : "";
    const pr = selected.player.includes("-")
      ? selected.player.split("-").slice(-1)[0]
      : "";
    if (cr && pr && cr.toLowerCase() !== pr.toLowerCase()) {
      return { charRealm: cr, playerRealm: pr };
    }
    return null;
  }, [selected]);

  const startNewConversation = useCallback(() => {
    const c = newCharacter.trim();
    const p = newPlayer.trim();
    if (!c || !p) return;
    setSelected({ character: c, player: p });
    setNewPlayer("");
    if (!conversations.some((cv) => cv.character === c && cv.player === p)) {
      setConversations((prev) => [
        {
          character: c,
          player: p,
          lastAt: new Date().toISOString(),
          lastBody: "(nova conversa)",
          lastDirection: "outgoing",
          incomingCount: 0,
          totalCount: 0,
        },
        ...prev,
      ]);
    }
  }, [newCharacter, newPlayer, conversations]);

  const filteredConversations = useMemo(() => {
    if (characterFilter === ALL) return conversations;
    return conversations.filter((c) => sameName(c.character, characterFilter));
  }, [conversations, characterFilter]);

  const visibleConversations = useMemo(
    () => filteredConversations.slice(0, conversationLimit),
    [filteredConversations, conversationLimit],
  );

  useEffect(() => {
    setConversationLimit(INITIAL_CONVERSATION_LIMIT);
  }, [characterFilter]);

  const totalPendingOut = useMemo(
    () => characters.reduce((s, c) => s + c.pendingOut, 0),
    [characters],
  );

  // Clear unread badges when tab becomes visible
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Don't clear unreads immediately — let user see the badges.
        // They clear when the user opens each conversation.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

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
                {totalWindowsOnline} janela(s) online
              </span>
              · {characters.length} personagens · {conversations.length}{" "}
              conversas
              {totalPendingOut > 0 && (
                <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
                  {totalPendingOut} pendente(s)
                </span>
              )}
            </p>
          </div>
        </div>
        <nav className="order-last -mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5 text-xs md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0 md:pb-0">
          <a
            href="/download"
            className="whitespace-nowrap rounded border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-amber-300 hover:bg-amber-500/20 md:px-3"
          >
            📥 Download
          </a>
          <a
            href="/accounts"
            className="whitespace-nowrap rounded border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/20 md:px-3"
          >
            📡 Contas
          </a>
          <a
            href="/gse"
            className="whitespace-nowrap rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2.5 py-1 text-fuchsia-300 hover:bg-fuchsia-500/20 md:px-3"
          >
            ⚙ GSE
          </a>
          <a
            href="/settings"
            className="whitespace-nowrap rounded border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 text-sky-300 hover:bg-sky-500/20 md:px-3"
          >
            🔐 Config
          </a>
          <a
            href="/setup"
            className="whitespace-nowrap rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800 md:px-3"
          >
            Setup
          </a>
        </nav>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <div className="relative">
            <button
              onClick={() => setShowNotifSettings((s) => !s)}
              className={`rounded border px-3 py-1 transition ${
                notif.prefs.sound || notif.prefs.desktop
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                  : "border-slate-700 text-slate-400 hover:bg-slate-800"
              }`}
              title="Preferências de notificação"
            >
              {notif.prefs.sound ? "🔔" : "🔕"}
            </button>
            {showNotifSettings && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Notificações
                </div>
                <label className="flex cursor-pointer items-center justify-between py-2 text-sm">
                  <span>🔔 Som ao receber whisper</span>
                  <input
                    type="checkbox"
                    checked={notif.prefs.sound}
                    onChange={(e) => notif.setSound(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                </label>
                <div className="mb-2 flex items-center gap-2 py-1 text-xs text-slate-400">
                  <span>Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={notif.prefs.volume}
                    onChange={(e) =>
                      notif.setVolume(parseFloat(e.target.value))
                    }
                    className="flex-1 accent-amber-500"
                    disabled={!notif.prefs.sound}
                  />
                  <button
                    onClick={notif.testChime}
                    disabled={!notif.prefs.sound}
                    className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  >
                    testar
                  </button>
                </div>
                <label className="flex cursor-pointer items-center justify-between py-2 text-sm">
                  <span>💻 Notificação do navegador</span>
                  <input
                    type="checkbox"
                    checked={notif.prefs.desktop}
                    onChange={(e) => void notif.setDesktop(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                </label>
                <p className="mt-2 text-[10px] text-slate-500">
                  O som só toca em navegadores que permitem áudio após a
                  primeira interação com a página (clique/tecla).
                </p>
              </div>
            )}
          </div>
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeUp === null
                ? "bg-slate-500"
                : bridgeUp
                  ? "bg-emerald-400"
                  : "bg-rose-500"
            }`}
          />
          <span className="hidden text-slate-400 sm:inline">
            {bridgeUp === null
              ? "conectando..."
              : bridgeUp
                ? "API online"
                : "sem conexão"}
          </span>
        </div>
      </header>

      {/* Character filter bar */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-800 bg-slate-900/50 px-3 py-2 text-xs sm:px-4">
        <button
          onClick={() => setCharacterFilter(ALL)}
          className={`whitespace-nowrap rounded-full border px-3 py-1 transition ${
            characterFilter === ALL
              ? "border-amber-500 bg-amber-500/10 text-amber-300"
              : "border-slate-700 text-slate-300 hover:bg-slate-800"
          }`}
        >
          Todos ({conversations.length})
        </button>
        {characters.map((c) => {
          const st = statusMap[c.character];
          const online = st?.online;
          return (
            <button
              key={c.character}
              onClick={() => setCharacterFilter(c.character)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 transition ${
                characterFilter === c.character
                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                  : `${realmColor(c.character)} hover:opacity-80`
              }`}
              title={
                st
                  ? `${online ? "online" : "offline"} — ${st.windowTitle}`
                  : "janela não detectada"
              }
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  online
                    ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-500/60"
                    : "bg-slate-600"
                }`}
              />
              {c.character}
              {c.pendingOut > 0 && (
                <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">
                  {c.pendingOut}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: full-width on mobile when no chat selected, responsive width on tablets/desktop */}
        <aside
          className={`${
            selected ? "hidden md:flex" : "flex"
          } w-full flex-col border-r border-slate-800 bg-slate-900/40 md:w-80 lg:w-96`}
        >
          <div className="border-b border-slate-800 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Nova conversa
            </div>
            <div className="flex flex-col gap-2">
              <input
                value={newCharacter}
                onChange={(e) => setNewCharacter(e.target.value)}
                placeholder="Seu personagem (ex: Aragorn-Nemesis)"
                list="known-chars"
                className="rounded bg-slate-800 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
              />
              <datalist id="known-chars">
                {characters.map((c) => (
                  <option key={c.character} value={c.character} />
                ))}
              </datalist>
              <div className="flex gap-2">
                <input
                  value={newPlayer}
                  onChange={(e) => setNewPlayer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startNewConversation();
                  }}
                  placeholder="Whisper para: Nome-Reino"
                  className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
                />
                <button
                  onClick={startNewConversation}
                  className="rounded bg-amber-600 px-3 text-sm font-semibold text-slate-900 hover:bg-amber-500"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                Nenhuma conversa {characterFilter !== ALL && "para este personagem"}.
                <br />
                Aguarde um whisper ou inicie um novo acima.
              </div>
            )}
            {visibleConversations.map((c) => {
              const convKey = `${c.character}::${c.player}`;
              const active =
                selected?.character === c.character && selected?.player === c.player;
              const hasUnread = unreadMap[convKey];
              return (
                <button
                  key={convKey}
                  onClick={() =>
                    setSelected({ character: c.character, player: c.player })
                  }
                  style={{ contentVisibility: "auto", containIntrinsicSize: "72px" }}
                  className={`flex w-full flex-col gap-1 border-b border-slate-800/60 px-4 py-3 text-left transition ${
                    active
                      ? "bg-amber-500/10 border-l-2 border-l-amber-500"
                      : hasUnread
                        ? "bg-amber-500/5 border-l-2 border-l-amber-400/50"
                        : "hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate ${
                        hasUnread
                          ? "font-bold text-amber-200"
                          : "font-semibold text-slate-100"
                      }`}
                    >
                      {c.player}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {hasUnread && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950">
                          !
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        {timeAgo(c.lastAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${realmColor(c.character)}`}
                    >
                      {c.character}
                    </span>
                    <span
                      className={`truncate text-xs ${
                        hasUnread ? "font-medium text-amber-300" : "text-slate-400"
                      }`}
                    >
                      {c.lastDirection === "outgoing" ? "→ " : ""}
                      {c.lastBody}
                    </span>
                  </div>
                </button>
              );
              })}
            {filteredConversations.length > visibleConversations.length && (
              <button
                onClick={() =>
                  setConversationLimit((current) => current + INITIAL_CONVERSATION_LIMIT)
                }
                className="m-3 w-[calc(100%-1.5rem)] rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                Mostrar mais conversas ({filteredConversations.length - visibleConversations.length})
              </button>
            )}
          </div>
        </aside>

        {/* Message pane: full-width on mobile when chat selected */}
        <main
          className={`${
            selected ? "flex" : "hidden md:flex"
          } flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(120,80,20,0.15),transparent_60%)]`}
        >
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-slate-500">
              <div className="text-6xl">💬</div>
              <div>Selecione uma conversa</div>
              <div className="text-xs">
                ou aguarde um whisper chegar em qualquer uma das suas janelas.
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="shrink-0 border-b border-slate-800 px-3 py-2.5 sm:px-6 sm:py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button
                      onClick={() => setSelected(null)}
                      aria-label="Voltar para a lista de conversas"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:bg-slate-700 md:hidden"
                    >
                      ←
                    </button>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-amber-300">
                        {selected.player}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono ${realmColor(selected.character)}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              statusMap[selected.character]?.online
                                ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-500/60"
                                : "bg-slate-600"
                            }`}
                          />
                          {selected.character}
                        </span>
                        {statusMap[selected.character]?.online ? (
                          <span className="text-emerald-400">
                            online
                          </span>
                        ) : (
                          <span className="text-rose-400">
                            offline — envio pode falhar
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => void clearConversation()}
                    disabled={clearingConversation || messages.length === 0}
                    className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800/50 disabled:text-slate-500 sm:px-3 sm:text-xs"
                    title="Apagar todas as mensagens desta conversa"
                  >
                    {clearingConversation ? "apagando..." : "🗑 Limpar"}
                  </button>
                </div>
                {realmMismatch && (
                  <div className="mt-2 rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    ⚠ <b>Servidor diferente:</b> seu personagem está em{" "}
                    <b>{realmMismatch.charRealm}</b> mas o destinatário está em{" "}
                    <b>{realmMismatch.playerRealm}</b>. A mensagem pode falhar
                    se os servidores não forem conectados.
                  </div>
                )}
              </div>

              {/* Messages area */}
              <div
                ref={scrollRef}
                onScroll={onChatScroll}
                className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4"
              >
                {messages.length === 0 && (
                  <div className="pt-12 text-center text-sm text-slate-500">
                    Sem mensagens ainda entre {selected.character} e{" "}
                    {selected.player}.
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.direction === "outgoing";
                  const badge = statusBadge(m.status);
                  return (
                    <div
                      key={m.id}
                      className={`flex ${mine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow sm:max-w-lg sm:px-4 ${
                          mine
                            ? "bg-amber-600 text-slate-950"
                            : "bg-slate-800 text-slate-100"
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words text-[13px] sm:text-sm">
                          {m.body}
                        </div>
                        <div
                          className={`mt-1 flex flex-wrap items-center gap-1.5 text-[10px] ${
                            mine ? "text-slate-900/70" : "text-slate-400"
                          }`}
                        >
                          <span>
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {mine && badge.label && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.classes || "bg-slate-900/20"}`}
                            >
                              {badge.label}
                            </span>
                          )}
                          {m.error && (
                            <span className="text-rose-800">— {m.error}</span>
                          )}
                          <button
                            onClick={() => void deleteMessage(m)}
                            disabled={deletingIds[m.id]}
                            className={`ml-auto rounded px-1.5 py-0.5 transition disabled:opacity-50 ${
                              mine
                                ? "text-slate-900/70 hover:bg-slate-950/10 hover:text-slate-950"
                                : "text-slate-500 hover:bg-slate-700 hover:text-rose-300"
                            }`}
                            title="Apagar mensagem"
                            aria-label="Apagar mensagem"
                          >
                            {deletingIds[m.id] ? "..." : "🗑"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input area */}
              <div className="shrink-0 border-t border-slate-800 bg-slate-900/60 p-2.5 sm:p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, 255))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendReply();
                      }
                    }}
                    rows={2}
                    placeholder={`Responder ${selected.player}...`}
                    className="flex-1 resize-none rounded-xl bg-slate-800 px-3 py-2.5 text-sm placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500/60"
                  />
                  <button
                    onClick={() => void sendReply()}
                    disabled={sending || !draft.trim()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-lg font-bold text-slate-950 shadow disabled:opacity-40 hover:bg-amber-400"
                    title="Enviar mensagem"
                  >
                    {sending ? "..." : "➤"}
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="hidden sm:inline">
                    via <b>{selected.character}</b> ·{" "}
                    <code>/w {selected.player}</code>
                  </span>
                  <span>{draft.length}/255</span>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
