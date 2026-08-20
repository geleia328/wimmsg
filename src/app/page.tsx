"use client";

import React, { useState, useEffect, useRef } from "react";

interface Character {
  id: number;
  name: string;
  avatarUrl: string | null;
  description: string | null;
  greeting: string | null;
  personality: string | null;
  systemPrompt: string | null;
}

interface Player {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface Message {
  id: number;
  conversationId: number;
  senderType: string;
  content: string;
  createdAt: string;
}

interface GseGlobal {
  id: number;
  leitorWindowsActive: boolean;
  masterGseActive: boolean;
  pressEscAfterSend: boolean;
  delayEnter: number;
  delayBeforeSpace: number;
  delaySpaceWhisper: number;
  delayFocusWindow: number;
  delayBetweenKeys: number;
  delaySendMsg: number;
  delayAfterWhisper: number;
  delayPollQueue: number;
}

interface GseCharacter {
  id: number;
  name: string;
  slot: string;
  status: string;
  keyGse: string;
  intervalMs: number;
  isRodando: boolean;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"gse" | "chat" | "characters" | "players" | "settings">("gse");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // GSE State
  const [gseGlobal, setGseGlobal] = useState<GseGlobal>({
    id: 1,
    leitorWindowsActive: false,
    masterGseActive: true,
    pressEscAfterSend: false,
    delayEnter: 500,
    delayBeforeSpace: 500,
    delaySpaceWhisper: 500,
    delayFocusWindow: 500,
    delayBetweenKeys: 500,
    delaySendMsg: 500,
    delayAfterWhisper: 500,
    delayPollQueue: 500,
  });
  const [gseChars, setGseChars] = useState<GseCharacter[]>([]);
  const [gseSaving, setGseSaving] = useState(false);
  const [gseSaveMsg, setGseSaveMsg] = useState("");
  const [newGseCharName, setNewGseCharName] = useState("");

  // Character form state
  const [charForm, setCharForm] = useState({
    name: "",
    avatarUrl: "",
    description: "",
    greeting: "",
    personality: "",
    systemPrompt: "",
  });

  // Player form state
  const [playerForm, setPlayerForm] = useState({
    username: "",
    displayName: "",
    avatarUrl: "",
  });

  // Settings state
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [bridgeToken, setBridgeToken] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedCharacter && selectedPlayer) {
      loadConversation(selectedCharacter.id, selectedPlayer.id);
    }
  }, [selectedCharacter, selectedPlayer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [charsRes, playersRes, settingsRes, gseRes] = await Promise.all([
        fetch("/api/characters"),
        fetch("/api/players"),
        fetch("/api/settings"),
        fetch("/api/gse"),
      ]);

      const charsData = await charsRes.json();
      const playersData = await playersRes.json();
      const settingsData = await settingsRes.json();
      const gseData = await gseRes.json();

      setCharacters(charsData);
      setPlayers(playersData);
      setSettings(settingsData);
      setBridgeToken(settingsData.WIMS_BRIDGE_TOKEN || "");

      if (gseData.global) setGseGlobal(gseData.global);
      if (gseData.characters) setGseChars(gseData.characters);

      // Seed default GSE characters if empty
      if (!gseData.characters || gseData.characters.length === 0) {
        await seedDefaultGse();
      }

      if (charsData.length === 0) {
        await createDefaultCharacter();
      } else {
        setSelectedCharacter(charsData[0]);
      }

      if (playersData.length === 0) {
        await createDefaultPlayer();
      } else {
        setSelectedPlayer(playersData[0]);
      }
    } catch (err) {
      console.error("Failed to load initial data", err);
    } finally {
      setLoading(false);
    }
  }

  async function seedDefaultGse() {
    const defaults = [
      { name: "Mangolibre-Stormrage", slot: "wow0", keyGse: "F5", intervalMs: 2000 },
      { name: "Sabistion-Stormrage", slot: "wow0", keyGse: "F5", intervalMs: 2000 },
      { name: "Shadowlivre-Stormrage", slot: "wow0", keyGse: "F5", intervalMs: 2000 },
      { name: "Subortion-Stormrage", slot: "wow0", keyGse: "F5", intervalMs: 2000 },
    ];

    for (const d of defaults) {
      await fetch("/api/gse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "add_character", data: d }),
      });
    }

    const res = await fetch("/api/gse");
    const data = await res.json();
    if (data.characters) setGseChars(data.characters);
  }

  async function createDefaultCharacter() {
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Aria AI",
        avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80",
        description: "An advanced conversational AI assistant for roleplay and immersive messaging.",
        greeting: "Greetings! I am Aria, your dynamic AI bridge companion. How may I assist your mission today?",
        personality: "Helpful, insightful, creative, and engaging.",
        systemPrompt: "You are Aria, an advanced AI companion in WIMS.",
      }),
    });
    const newChar = await res.json();
    setCharacters([newChar]);
    setSelectedCharacter(newChar);
  }

  async function createDefaultPlayer() {
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "commander",
        displayName: "Commander",
        avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&auto=format&fit=crop&q=80",
      }),
    });
    const newPlayer = await res.json();
    setPlayers([newPlayer]);
    setSelectedPlayer(newPlayer);
  }

  async function loadConversation(cId: number, pId: number) {
    try {
      const res = await fetch(`/api/conversations/${cId}/${pId}`);
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
    } catch (err) {
      console.error("Failed to load conversation", err);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedCharacter || !selectedPlayer || sending) return;

    const content = inputMessage;
    setInputMessage("");
    setSending(true);

    try {
      const res = await fetch(`/api/conversations/${selectedCharacter.id}/${selectedPlayer.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          senderType: "player",
          generateReply: true,
        }),
      });

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
      if (data.reply) {
        setMessages((prev) => [...prev, data.reply]);
      }
    } catch (err) {
      console.error("Failed to send message", err);
    } finally {
      setSending(false);
    }
  }

  async function handleSaveGseGlobal(e: React.FormEvent) {
    e.preventDefault();
    setGseSaving(true);
    setGseSaveMsg("");
    try {
      const res = await fetch("/api/gse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "global",
          data: gseGlobal,
        }),
      });
      const data = await res.json();
      setGseGlobal(data);
      setGseSaveMsg("Delays salvos com sucesso!");
      setTimeout(() => setGseSaveMsg(""), 3000);
    } catch (err) {
      console.error("Failed to save GSE global", err);
    } finally {
      setGseSaving(false);
    }
  }

  async function handleToggleGlobalLeitor() {
    const updated = { ...gseGlobal, leitorWindowsActive: !gseGlobal.leitorWindowsActive };
    setGseGlobal(updated);
    await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "global", data: updated }),
    });
  }

  async function handleToggleGlobalMaster() {
    const updated = { ...gseGlobal, masterGseActive: !gseGlobal.masterGseActive };
    setGseGlobal(updated);
    await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "global", data: updated }),
    });
  }

  async function handleToggleGlobalEsc() {
    const updated = { ...gseGlobal, pressEscAfterSend: !gseGlobal.pressEscAfterSend };
    setGseGlobal(updated);
    await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "global", data: updated }),
    });
  }

  async function handleToggleAllCharacters(isRodando: boolean) {
    const res = await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "toggle_all", data: { isRodando } }),
    });
    const data = await res.json();
    if (data.characters) setGseChars(data.characters);
  }

  async function handleToggleCharacter(id: number, currentRodando: boolean) {
    const res = await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "toggle_character", data: { id, isRodando: !currentRodando } }),
    });
    const updated = await res.json();
    setGseChars(gseChars.map((c) => (c.id === id ? updated : c)));
  }

  async function handleDeleteGseChar(id: number) {
    await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "delete_character", data: { id } }),
    });
    setGseChars(gseChars.filter((c) => c.id !== id));
  }

  async function handleUpdateGseCharField(id: number, field: string, val: any) {
    const target = gseChars.find((c) => c.id === id);
    if (!target) return;
    const updatedData = { ...target, [field]: val };

    const res = await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "update_character",
        data: {
          id,
          keyGse: updatedData.keyGse,
          intervalMs: updatedData.intervalMs,
          slot: updatedData.slot,
          status: updatedData.status,
          name: updatedData.name,
        },
      }),
    });
    const saved = await res.json();
    setGseChars(gseChars.map((c) => (c.id === id ? saved : c)));
  }

  async function handleAddGseChar(e: React.FormEvent) {
    e.preventDefault();
    if (!newGseCharName.trim()) return;

    const res = await fetch("/api/gse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "add_character",
        data: {
          name: newGseCharName.trim(),
          slot: "wow0",
          keyGse: "F5",
          intervalMs: 2000,
        },
      }),
    });
    const added = await res.json();
    setGseChars([...gseChars, added]);
    setNewGseCharName("");
  }

  const runningCount = gseChars.filter((c) => c.isRodando).length;

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans">
      {/* Top Deployment & Status Header */}
      <div className="bg-gradient-to-r from-emerald-950 via-teal-950 to-indigo-950 border-b border-emerald-500/30 px-6 py-2.5 text-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
            Conectado
          </span>
          <span className="text-slate-300">
            • GitHub: <strong className="text-white">geleia328/wimmsg</strong> • Vercel Ready
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded border border-emerald-500/30 font-mono">
            Build 100% Passing
          </span>
          <button
            onClick={() => setActiveTab("chat")}
            className="hover:underline text-indigo-300 font-medium flex items-center gap-1"
          >
            ← Ir para Chat
          </button>
        </div>
      </div>

      {/* Main Navigation Header */}
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-600/30">
            W
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              Controle GSE
              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 font-normal">
                Ativa/desativa o macro GSE em cada janela ({runningCount} rodando)
              </span>
            </h1>
            <p className="text-xs text-slate-400">WIMS & Advanced Macros Automation Hub</p>
          </div>
        </div>

        <nav className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("gse")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "gse"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            ⚡ Painel GSE
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "chat"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            💬 Chat AI
          </button>
          <button
            onClick={() => setActiveTab("characters")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "characters"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            👥 Characters ({characters.length})
          </button>
          <button
            onClick={() => setActiveTab("players")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "players"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            🛡️ Players ({players.length})
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "settings"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            ⚙️ Settings & Token
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-slate-400 text-sm">Carregando painel GSE...</p>
            </div>
          </div>
        ) : (
          <>
            {/* GSE TAB */}
            {activeTab === "gse" && (
              <div className="space-y-6">
                {/* Top Section: Controle Global */}
                <div className="bg-[#0e1526] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
                  <div className="text-xs font-bold text-slate-400 tracking-wider uppercase">
                    Controle Global
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Leitor de janelas */}
                    <div className="bg-[#131d35] border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-sm text-white">Leitor de janelas/whispers</div>
                        <div className="text-xs text-slate-400 mt-0.5">Mantém scan de contas + leitura do chat log ativa.</div>
                      </div>
                      <button
                        onClick={handleToggleGlobalLeitor}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md ${
                          gseGlobal.leitorWindowsActive
                            ? "bg-emerald-600 text-white shadow-emerald-600/30"
                            : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                        }`}
                      >
                        {gseGlobal.leitorWindowsActive ? "LIGADO" : "DESLIGADO"}
                      </button>
                    </div>

                    {/* Master GSE */}
                    <div className="bg-[#131d35] border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-sm text-white">Master GSE</div>
                        <div className="text-xs text-slate-400 mt-0.5">Se desligado, nenhuma janela recebe clique/tecla GSE.</div>
                      </div>
                      <button
                        onClick={handleToggleGlobalMaster}
                        className={`px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-md ${
                          gseGlobal.masterGseActive
                            ? "bg-purple-600 text-white shadow-purple-600/30"
                            : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                        }`}
                      >
                        {gseGlobal.masterGseActive ? "GSE ON" : "GSE OFF"}
                      </button>
                    </div>
                  </div>

                  {/* Press ESC option */}
                  <div className="bg-[#131d35] border border-slate-800/80 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-bold text-sm text-white flex items-center gap-2">
                        Pressionar ESC para fechar o chat após enviar
                      </div>
                      <p className="text-xs text-amber-300/90 leading-relaxed">
                        ⚠️ Deixe DESLIGADO (padrão): o WoW já fecha o campo de chat sozinho depois de enviar — e pressionar ESC com o chat fechado ABRE O MENU do jogo (é isso que estava bugando). Só ligue se o seu WoW mantiver o chat aberto após enviar.
                      </p>
                    </div>
                    <button
                      onClick={handleToggleGlobalEsc}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap shadow-md ${
                        gseGlobal.pressEscAfterSend
                          ? "bg-amber-600 text-white shadow-amber-600/30"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                      }`}
                    >
                      {gseGlobal.pressEscAfterSend ? "LIGADO" : "DESLIGADO"}
                    </button>
                  </div>

                  {/* Delays Configuration Form */}
                  <form onSubmit={handleSaveGseGlobal} className="space-y-4 pt-2 border-t border-slate-800">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Depois do Enter (campo abrindo)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delayEnter}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delayEnter: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">espera após o Enter antes de colar /w (1s na ordem padrão)</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Antes do espaço (após /w Nome)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delayBeforeSpace}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delayBeforeSpace: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">espera após colar /w Nome-Server antes de pressionar espaço (1s)</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Espaço (abre o whisper)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delaySpaceWhisper}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delaySpaceWhisper: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">espera após pressionar espaço antes de colar a mensagem (1s)</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Foco da janela (antes do Enter)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delayFocusWindow}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delayFocusWindow: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">espera a janela assumir o foco (2s na ordem padrão)</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Entre cada tecla digitada (fallback)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delayBetweenKeys}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delayBetweenKeys: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">fallback, sem colar</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Enviar mensagem (após colar a msg)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delaySendMsg}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delaySendMsg: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">espera após colar a mensagem antes do Enter (1s)</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Depois de enviar whisper (liberar GSE)
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delayAfterWhisper}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delayAfterWhisper: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">espera após o Enter de envio (1s)</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Poll da fila de whisper
                        </label>
                        <input
                          type="number"
                          value={gseGlobal.delayPollQueue}
                          onChange={(e) => setGseGlobal({ ...gseGlobal, delayPollQueue: parseInt(e.target.value) || 0 })}
                          className="w-full bg-[#090d16] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-[10px] text-slate-500 mt-0.5 block">intervalo de varredura da fila</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between pt-3">
                      <div className="text-xs text-slate-400 font-mono">
                        Ordem salva: foco {gseGlobal.delayFocusWindow}ms · pós-Enter {gseGlobal.delayEnter}ms · antes do espaço {gseGlobal.delayBeforeSpace}ms · pós-espaço {gseGlobal.delaySpaceWhisper}ms · pós-colar {gseGlobal.delaySendMsg}ms · pós-envio {gseGlobal.delayAfterWhisper}ms
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="submit"
                          disabled={gseSaving}
                          className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-amber-600/20 flex items-center gap-1.5"
                        >
                          💾 Salvar delays
                        </button>
                        {gseSaveMsg && <span className="text-xs text-emerald-400 font-medium">{gseSaveMsg}</span>}
                      </div>
                    </div>
                  </form>

                  {/* Master Action Buttons */}
                  <div className="flex flex-wrap items-center gap-4 pt-4 border-t border-slate-800">
                    <button
                      onClick={() => handleToggleAllCharacters(true)}
                      className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2"
                    >
                      ▶ Iniciar TODOS ({gseChars.length})
                    </button>
                    <button
                      onClick={() => handleToggleAllCharacters(false)}
                      className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2"
                    >
                      ⏹ Parar TODOS
                    </button>
                  </div>

                  <div className="text-xs text-amber-300/90 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 rounded-xl">
                    <span>💡</span>
                    <span>O leitor pode ficar ligado com o GSE desligado. O GSE só roda quando Master GSE está ON e o personagem também está marcado como rodando.</span>
                  </div>
                </div>

                {/* Bottom Section: Character Table & Add */}
                <div className="bg-[#0e1526] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="text-xs font-bold text-slate-400 tracking-wider uppercase">
                      Gerenciamento de Personagens GSE ({gseChars.length})
                    </div>

                    <form onSubmit={handleAddGseChar} className="flex gap-2 w-full md:w-auto">
                      <input
                        type="text"
                        value={newGseCharName}
                        onChange={(e) => setNewGseCharName(e.target.value)}
                        placeholder="Novo-Realm..."
                        className="bg-[#090d16] border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all whitespace-nowrap"
                      >
                        + Adicionar Janela
                      </button>
                    </form>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="py-3 px-4">Personagem</th>
                          <th className="py-3 px-4">Slot</th>
                          <th className="py-3 px-4">Status Janela</th>
                          <th className="py-3 px-4">Tecla GSE</th>
                          <th className="py-3 px-4">Intervalo</th>
                          <th className="py-3 px-4">GSE</th>
                          <th className="py-3 px-4 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
                        {gseChars.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-900/40 transition-colors">
                            <td className="py-3.5 px-4 font-sans font-bold text-teal-300">
                              <input
                                type="text"
                                value={c.name}
                                onChange={(e) => handleUpdateGseCharField(c.id, "name", e.target.value)}
                                className="bg-transparent border border-transparent hover:border-slate-700 focus:border-indigo-500 rounded px-1.5 py-0.5 text-teal-300 w-full"
                              />
                            </td>
                            <td className="py-3.5 px-4 text-slate-300">
                              <select
                                value={c.slot}
                                onChange={(e) => handleUpdateGseCharField(c.id, "slot", e.target.value)}
                                className="bg-[#090d16] border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                              >
                                <option value="wow0">wow0</option>
                                <option value="wow1">wow1</option>
                                <option value="wow2">wow2</option>
                                <option value="wow3">wow3</option>
                              </select>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                online
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-200">
                              <input
                                type="text"
                                value={c.keyGse}
                                onChange={(e) => handleUpdateGseCharField(c.id, "keyGse", e.target.value)}
                                className="bg-[#090d16] border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono w-20 text-center"
                              />
                            </td>
                            <td className="py-3.5 px-4 text-slate-200">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={c.intervalMs}
                                  onChange={(e) => handleUpdateGseCharField(c.id, "intervalMs", parseInt(e.target.value) || 1000)}
                                  className="bg-[#090d16] border border-slate-800 rounded px-2 py-1 text-xs text-white font-mono w-24 text-right"
                                />
                                <span className="text-slate-400 text-[10px]">ms</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <button
                                onClick={() => handleToggleCharacter(c.id, c.isRodando)}
                                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                                  c.isRodando
                                    ? "bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30"
                                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30"
                                }`}
                              >
                                {c.isRodando ? "■ parar" : "▶ rodar"}
                              </button>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={() => handleDeleteGseChar(c.id)}
                                className="text-slate-500 hover:text-rose-400 font-sans px-2 py-1 rounded transition-colors text-sm"
                                title="Remover"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Configurar GSE guide */}
                  <div className="mt-6 pt-6 border-t border-slate-800 text-xs text-slate-400 space-y-2 bg-[#131d35] p-5 rounded-xl border border-slate-800/80">
                    <div className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                      Como configurar o GSE:
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-slate-300">
                      <li>Instale o addon GSE - Advanced Macros no CurseForge/WoWUP e crie sua sequência.</li>
                      <li>No WoW, arraste a macro do GSE para a barra de ação e anote em qual tecla ela está (ex. <code className="text-indigo-300 font-mono">1, F1, NUMPAD1</code>).</li>
                      <li>Configure a mesma tecla no campo <code className="text-indigo-300 font-mono">"Tecla GSE"</code> acima para cada personagem.</li>
                      <li>Clique <span className="text-emerald-400 font-bold">▶ Iniciar</span>. O Python/Bot vai spammear essa tecla em background.</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* CHAT TAB */}
            {activeTab === "chat" && (
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-6">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                      Select Character
                    </h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {characters.map((char) => (
                        <button
                          key={char.id}
                          onClick={() => setSelectedCharacter(char)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left ${
                            selectedCharacter?.id === char.id
                              ? "bg-indigo-600/20 border border-indigo-500/50 text-white"
                              : "hover:bg-slate-800/60 text-slate-300 border border-transparent"
                          }`}
                        >
                          <img
                            src={char.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400"}
                            alt={char.name}
                            className="w-10 h-10 rounded-full object-cover border border-slate-700"
                          />
                          <div className="overflow-hidden">
                            <div className="font-semibold text-sm truncate">{char.name}</div>
                            <div className="text-xs text-slate-400 truncate">{char.description || "Active AI"}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setActiveTab("characters")}
                      className="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-all border border-slate-700"
                    >
                      + Add New Character
                    </button>
                  </div>

                  <hr className="border-slate-800" />

                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                      Select Player Profile
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {players.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPlayer(p)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left ${
                            selectedPlayer?.id === p.id
                              ? "bg-indigo-600/20 border border-indigo-500/50 text-white"
                              : "hover:bg-slate-800/60 text-slate-300 border border-transparent"
                          }`}
                        >
                          <img
                            src={p.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400"}
                            alt={p.displayName}
                            className="w-9 h-9 rounded-full object-cover border border-slate-700"
                          />
                          <div className="overflow-hidden">
                            <div className="font-semibold text-sm truncate">{p.displayName}</div>
                            <div className="text-xs text-slate-400 truncate">@{p.username}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setActiveTab("players")}
                      className="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-all border border-slate-700"
                    >
                      + Add New Player
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-3 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col h-[70vh] shadow-xl">
                  <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 rounded-t-2xl">
                    <div className="flex items-center gap-3">
                      {selectedCharacter && (
                        <img
                          src={selectedCharacter.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400"}
                          alt={selectedCharacter.name}
                          className="w-10 h-10 rounded-full object-cover border border-indigo-500/40"
                        />
                      )}
                      <div>
                        <h2 className="font-bold text-base flex items-center gap-2">
                          {selectedCharacter?.name || "Select a character"}
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        </h2>
                        <p className="text-xs text-slate-400">
                          {selectedCharacter?.personality || "Ready for messaging"}
                        </p>
                      </div>
                    </div>
                    <div className="text-xs bg-indigo-500/10 text-indigo-300 px-3 py-1.5 rounded-lg border border-indigo-500/20 font-mono">
                      Bridge: {bridgeToken ? "Active (Custom)" : "Default System"}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {messages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                        <div className="w-16 h-16 rounded-full bg-slate-800/80 flex items-center justify-center text-2xl mb-3">
                          💬
                        </div>
                        <p className="text-sm font-medium text-slate-300">No messages in this conversation yet</p>
                        <p className="text-xs text-slate-500 mt-1">Say hello to start roleplaying or chatting!</p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isPlayer = msg.senderType === "player";
                        return (
                          <div
                            key={msg.id}
                            className={`flex gap-3 ${isPlayer ? "justify-end" : "justify-start"}`}
                          >
                            {!isPlayer && (
                              <img
                                src={selectedCharacter?.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400"}
                                alt="Character"
                                className="w-8 h-8 rounded-full object-cover mt-1 flex-shrink-0"
                              />
                            )}
                            <div
                              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md ${
                                isPlayer
                                  ? "bg-indigo-600 text-white rounded-br-none"
                                  : "bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/60"
                              }`}
                            >
                              <div className="text-xs opacity-75 mb-1 font-medium">
                                {isPlayer ? selectedPlayer?.displayName || "Player" : selectedCharacter?.name || "Character"}
                              </div>
                              <div className="whitespace-pre-wrap">{msg.content}</div>
                            </div>
                            {isPlayer && (
                              <img
                                src={selectedPlayer?.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400"}
                                alt="Player"
                                className="w-8 h-8 rounded-full object-cover mt-1 flex-shrink-0"
                              />
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900/80 rounded-b-2xl flex gap-3">
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder={`Message ${selectedCharacter?.name || "Character"}...`}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={sending || !inputMessage.trim()}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-3 rounded-xl text-sm transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
                    >
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* CHARACTERS TAB */}
            {activeTab === "characters" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 md:col-span-1">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <span>✨</span> Create Character
                  </h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!charForm.name) return;
                      const res = await fetch("/api/characters", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(charForm),
                      });
                      const newChar = await res.json();
                      setCharacters([...characters, newChar]);
                      setSelectedCharacter(newChar);
                      setCharForm({ name: "", avatarUrl: "", description: "", greeting: "", personality: "", systemPrompt: "" });
                      setActiveTab("chat");
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Character Name</label>
                      <input
                        type="text"
                        required
                        value={charForm.name}
                        onChange={(e) => setCharForm({ ...charForm, name: e.target.value })}
                        placeholder="e.g. Cyber Oracle"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Avatar Image URL</label>
                      <input
                        type="text"
                        value={charForm.avatarUrl}
                        onChange={(e) => setCharForm({ ...charForm, avatarUrl: e.target.value })}
                        placeholder="https://images.unsplash.com/..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
                      <input
                        type="text"
                        value={charForm.description}
                        onChange={(e) => setCharForm({ ...charForm, description: e.target.value })}
                        placeholder="Brief bio or role..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Initial Greeting</label>
                      <textarea
                        rows={2}
                        value={charForm.greeting}
                        onChange={(e) => setCharForm({ ...charForm, greeting: e.target.value })}
                        placeholder="First message the character sends..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Personality & Traits</label>
                      <input
                        type="text"
                        value={charForm.personality}
                        onChange={(e) => setCharForm({ ...charForm, personality: e.target.value })}
                        placeholder="Wise, witty, robotic..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm transition-all shadow-lg shadow-indigo-600/20"
                    >
                      Save Character
                    </button>
                  </form>
                </div>

                <div className="md:col-span-2 space-y-4">
                  <h2 className="text-lg font-bold mb-4">Existing Characters ({characters.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {characters.map((c) => (
                      <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                        <div className="flex items-start gap-4">
                          <img
                            src={c.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400"}
                            alt={c.name}
                            className="w-14 h-14 rounded-2xl object-cover border border-slate-700"
                          />
                          <div>
                            <h3 className="font-bold text-base">{c.name}</h3>
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{c.description || c.personality}</p>
                          </div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-xs text-indigo-400 font-mono">ID: #{c.id}</span>
                          <button
                            onClick={() => {
                              setSelectedCharacter(c);
                              setActiveTab("chat");
                            }}
                            className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium transition-all"
                          >
                            Start Chat
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* PLAYERS TAB */}
            {activeTab === "players" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 md:col-span-1">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <span>🛡️</span> Create Player Profile
                  </h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!playerForm.username || !playerForm.displayName) return;
                      const res = await fetch("/api/players", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(playerForm),
                      });
                      const newPlayer = await res.json();
                      setPlayers([...players, newPlayer]);
                      setSelectedPlayer(newPlayer);
                      setPlayerForm({ username: "", displayName: "", avatarUrl: "" });
                      setActiveTab("chat");
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Username (unique)</label>
                      <input
                        type="text"
                        required
                        value={playerForm.username}
                        onChange={(e) => setPlayerForm({ ...playerForm, username: e.target.value })}
                        placeholder="e.g. alex_dev"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Display Name</label>
                      <input
                        type="text"
                        required
                        value={playerForm.displayName}
                        onChange={(e) => setPlayerForm({ ...playerForm, displayName: e.target.value })}
                        placeholder="e.g. Alex"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Avatar Image URL</label>
                      <input
                        type="text"
                        value={playerForm.avatarUrl}
                        onChange={(e) => setPlayerForm({ ...playerForm, avatarUrl: e.target.value })}
                        placeholder="https://images.unsplash.com/..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm transition-all shadow-lg shadow-indigo-600/20"
                    >
                      Save Player
                    </button>
                  </form>
                </div>

                <div className="md:col-span-2 space-y-4">
                  <h2 className="text-lg font-bold mb-4">Existing Players ({players.length})</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {players.map((p) => (
                      <div key={p.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <img
                            src={p.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400"}
                            alt={p.displayName}
                            className="w-12 h-12 rounded-2xl object-cover border border-slate-700"
                          />
                          <div>
                            <h3 className="font-bold text-base">{p.displayName}</h3>
                            <p className="text-xs text-slate-400">@{p.username}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedPlayer(p);
                            setActiveTab("chat");
                          }}
                          className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium transition-all"
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SETTINGS TAB */}
            {activeTab === "settings" && (
              <div className="max-w-2xl mx-auto bg-slate-900/60 border border-slate-800 rounded-2xl p-8 space-y-6">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <span>⚙️</span> Dynamic Bridge Token & Settings
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Configure your WIMS bridge authentication token for external API integrations and secure Vercel deployments.
                  </p>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSavingSettings(true);
                    setSettingsSaved(false);
                    try {
                      const res = await fetch("/api/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ key: "WIMS_BRIDGE_TOKEN", value: bridgeToken }),
                      });
                      const data = await res.json();
                      setSettings((prev) => ({ ...prev, WIMS_BRIDGE_TOKEN: data.value }));
                      setSettingsSaved(true);
                      setTimeout(() => setSettingsSaved(false), 3000);
                    } catch (err) {
                      console.error("Failed to save settings", err);
                    } finally {
                      setSavingSettings(false);
                    }
                  }}
                  className="space-y-5"
                >
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      WIMS Bridge Token
                    </label>
                    <input
                      type="password"
                      value={bridgeToken}
                      onChange={(e) => setBridgeToken(e.target.value)}
                      placeholder="wims_bridge_live_token_..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-xs text-slate-500 mt-1.5">
                      This token is securely stored in your PostgreSQL database via Drizzle ORM and exposed to server-side route handlers.
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-indigo-600/20"
                    >
                      {savingSettings ? "Saving..." : "Save Bridge Token"}
                    </button>
                    {settingsSaved && (
                      <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                        ✓ Saved successfully!
                      </span>
                    )}
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 px-6 py-4 text-center text-xs text-slate-500">
        WIMS & GSE Automation Platform • GitHub: <span className="text-slate-400 font-mono">geleia328/wimmsg</span>
      </footer>
    </div>
  );
}
