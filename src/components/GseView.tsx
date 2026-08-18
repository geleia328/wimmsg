"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WindowStatus = {
  character: string;
  windowTitle: string;
  slot: string;
  realm: string;
  online: boolean;
  matched: boolean;
};

type GseRow = {
  character: string;
  running: boolean;
  keybind: string;
  intervalMs: number;
  updatedAt: string;
};

type Controls = {
  bridgeReaderEnabled: boolean;
  gseMasterEnabled: boolean;
  whisperFocusDelayMs: number;
  whisperAfterSendDelayMs: number;
  whisperChatOpenDelayMs: number;
  whisperKeystrokeDelayMs: number;
  whisperChatSendDelayMs: number;
  whisperCloseChatEnabled: boolean;
  whisperChatCloseDelayMs: number;
  voiceRelayEnabled: boolean;
  combatRelayEnabled: boolean;
  queuePollMs: number;
};

const POLL_MS = 2000;

export function GseView() {
  const [windows, setWindows] = useState<WindowStatus[]>([]);
  const [states, setStates] = useState<Record<string, GseRow>>({});
  const [controls, setControls] = useState<Controls>({
    bridgeReaderEnabled: true,
    gseMasterEnabled: false,
    whisperFocusDelayMs: 2000,
    whisperAfterSendDelayMs: 1000,
    whisperChatOpenDelayMs: 1000,
    whisperKeystrokeDelayMs: 100,
    whisperChatSendDelayMs: 1000,
    whisperCloseChatEnabled: true,
    whisperChatCloseDelayMs: 500,
    voiceRelayEnabled: true,
    combatRelayEnabled: true,
    queuePollMs: 1500,
  });
  const [delayDraft, setDelayDraft] = useState({
    whisperFocusDelayMs: "2000",
    whisperAfterSendDelayMs: "1000",
    whisperChatOpenDelayMs: "1000",
    whisperKeystrokeDelayMs: "100",
    whisperChatSendDelayMs: "1000",
    whisperChatCloseDelayMs: "500",
    queuePollMs: "1500",
  });
  const [delayDirty, setDelayDirty] = useState(false);
  const [charDirty, setCharDirty] = useState<Record<string, boolean>>({});
  // Sync copy of charDirty so the polling refresh can read it without
  // recreating the interval (avoids overwriting unsaved character edits).
  const charDirtyRef = useRef<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [savingChars, setSavingChars] = useState(false);
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const [w, g, c] = await Promise.all([
        fetch("/api/status", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/gse", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/control", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setWindows((w as { windows: WindowStatus[] }).windows ?? []);
      const map: Record<string, GseRow> = {};
      for (const s of (g as { states: GseRow[] }).states ?? []) {
        map[s.character] = s;
      }
      // Merge server states but KEEP local unsaved edits (dirty characters)
      // so the 2s polling never overwrites what the user is typing.
      setStates((prev) => {
        const merged: Record<string, GseRow> = { ...map };
        for (const c of Object.keys(charDirtyRef.current)) {
          if (charDirtyRef.current[c] && prev[c]) merged[c] = prev[c];
        }
        return merged;
      });
      const nextControls = (c as { controls: Controls }).controls;
      setControls(nextControls);
      if (!delayDirty) {
        setDelayDraft({
          whisperFocusDelayMs: String(nextControls.whisperFocusDelayMs),
          whisperAfterSendDelayMs: String(nextControls.whisperAfterSendDelayMs),
          whisperChatOpenDelayMs: String(nextControls.whisperChatOpenDelayMs),
          whisperKeystrokeDelayMs: String(nextControls.whisperKeystrokeDelayMs),
          whisperChatSendDelayMs: String(nextControls.whisperChatSendDelayMs),
          whisperChatCloseDelayMs: String(nextControls.whisperChatCloseDelayMs),
          queuePollMs: String(nextControls.queuePollMs),
        });
      }
      setBridgeUp(true);
    } catch {
      setBridgeUp(false);
    }
  }, [delayDirty]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const characters = useMemo(() => {
    const set = new Set<string>();
    for (const w of windows) if (w.character) set.add(w.character);
    for (const c of Object.keys(states)) set.add(c);
    return Array.from(set).sort();
  }, [windows, states]);

  const runningCount = useMemo(
    () => characters.filter((c) => states[c]?.running).length,
    [characters, states],
  );

  const hasCharDirty = useMemo(
    () => Object.values(charDirty).some(Boolean),
    [charDirty],
  );

  const updateOne = useCallback(
    async (character: string, patch: Partial<GseRow>) => {
      setBusy((b) => ({ ...b, [character]: true }));
      try {
        await fetch(`/api/gse/${encodeURIComponent(character)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        await refresh();
      } finally {
        setBusy((b) => ({ ...b, [character]: false }));
      }
    },
    [refresh],
  );

  const saveAllCharChanges = useCallback(async () => {
    setSavingChars(true);
    try {
      for (const c of characters) {
        if (!charDirtyRef.current[c]) continue;
        const st = states[c];
        if (!st) continue;
        const res = await fetch(`/api/gse/${encodeURIComponent(c)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            keybind: st.keybind,
            intervalMs: st.intervalMs,
          }),
        });
        if (!res.ok) {
          alert(
            `Falha ao salvar ${c}. Verifique sua conexão e tente novamente.\n\n` +
              "As alterações não salvas foram preservadas.",
          );
          return;
        }
      }
      // Clear dirty BEFORE refreshing so the poll syncs the saved values.
      charDirtyRef.current = {};
      setCharDirty({});
      await refresh();
    } finally {
      setSavingChars(false);
    }
  }, [characters, states, refresh]);

  const removeCharacter = useCallback(
    async (character: string) => {
      const ok = window.confirm(
        `Remover ${character} da lista GSE?\n\nIsso apaga a configuração GSE deste personagem. O personagem volta à lista se for detectado novamente pelo bridge.`,
      );
      if (!ok) return;

      setRemoving((r) => ({ ...r, [character]: true }));
      try {
        const res = await fetch(`/api/gse/${encodeURIComponent(character)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          alert("Falha ao remover o personagem. Tente novamente.");
          return;
        }
        // Drop any pending local edits for this character before resyncing.
        const nd = { ...charDirtyRef.current };
        delete nd[character];
        charDirtyRef.current = nd;
        setCharDirty(nd);
        await refresh();
      } finally {
        setRemoving((r) => {
          const n = { ...r };
          delete n[character];
          return n;
        });
      }
    },
    [refresh],
  );

  const bulk = useCallback(
    async (action: "startAll" | "stopAll") => {
      await fetch("/api/gse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, characters }),
      });
      await refresh();
    },
    [characters, refresh],
  );

  const updateControls = useCallback(
    async (patch: Partial<Controls>): Promise<boolean> => {
      const adminToken = localStorage.getItem("bakers-whisper:admin-token") ?? "";
      try {
        const res = await fetch("/api/control", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-token": adminToken,
          },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          if (res.status === 401) {
            alert(
              "Não foi possível salvar: token admin inválido ou não configurado.\n\n" +
                "Abra 🔐 Config (/settings), cole o BRIDGE_TOKEN (ou ADMIN_TOKEN) no campo \"Acesso admin\" e clique em Entrar.\n" +
                "Depois volte aqui e clique em salvar novamente. Seus valores ficaram preservados.",
            );
          } else {
            alert("Erro ao salvar os controles. Tente novamente.");
          }
          return false;
        }
        await refresh();
        return true;
      } catch {
        alert("Sem conexão com o servidor. Verifique sua internet e tente novamente.");
        return false;
      }
    },
    [refresh],
  );

  const saveDelays = useCallback(async () => {
    const patch = {
      whisperFocusDelayMs: Number(delayDraft.whisperFocusDelayMs),
      whisperAfterSendDelayMs: Number(delayDraft.whisperAfterSendDelayMs),
      whisperChatOpenDelayMs: Number(delayDraft.whisperChatOpenDelayMs),
      whisperKeystrokeDelayMs: Number(delayDraft.whisperKeystrokeDelayMs),
      whisperChatSendDelayMs: Number(delayDraft.whisperChatSendDelayMs),
      whisperChatCloseDelayMs: Number(delayDraft.whisperChatCloseDelayMs),
      queuePollMs: Number(delayDraft.queuePollMs),
    };
    if (
      !Number.isFinite(patch.whisperFocusDelayMs) ||
      !Number.isFinite(patch.whisperAfterSendDelayMs) ||
      !Number.isFinite(patch.whisperChatOpenDelayMs) ||
      !Number.isFinite(patch.whisperKeystrokeDelayMs) ||
      !Number.isFinite(patch.whisperChatSendDelayMs) ||
      !Number.isFinite(patch.whisperChatCloseDelayMs) ||
      !Number.isFinite(patch.queuePollMs)
    ) {
      alert("Preencha todos os delays com números válidos.");
      return;
    }
    // Only clear the dirty flag when the save actually succeeded — otherwise
    // the next poll would overwrite the user's edits with old server values.
    const ok = await updateControls(patch);
    if (ok) setDelayDirty(false);
  }, [delayDraft, updateControls]);

  function setDraftField(key: keyof typeof delayDraft, value: string) {
    setDelayDirty(true);
    setDelayDraft((d) => ({ ...d, [key]: value }));
  }

  function setCharField(
    character: string,
    field: "keybind" | "intervalMs",
    value: string,
  ) {
    setStates((s) => ({
      ...s,
      [character]: {
        ...(s[character] ?? {
          character,
          running: false,
          keybind: "1",
          intervalMs: 100,
          updatedAt: new Date().toISOString(),
        }),
        [field]: field === "intervalMs" ? Number(value) : value,
      },
    }));
    charDirtyRef.current = { ...charDirtyRef.current, [character]: true };
    setCharDirty((d) => ({ ...d, [character]: true }));
  }

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-700 font-black text-white shadow">
            ⚙
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">Controle GSE</h1>
            <p className="truncate text-xs text-slate-400">
              Ativa/desativa o macro GSE em cada janela
              {runningCount > 0 && (
                <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
                  {runningCount} rodando
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              bridgeUp ? "bg-emerald-400" : "bg-rose-500"
            }`}
          />
          <span className="text-slate-400">
            {bridgeUp ? "conectado" : "sem conexão"}
          </span>
          <Link
            href="/"
            className="ml-4 rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
          >
            ← Chat
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Global controls */}
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
          <div className="mb-3 text-xs uppercase tracking-wider text-slate-500">
            Controle global
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-100">
                    Leitor de janelas/whispers
                  </div>
                  <div className="text-xs text-slate-500">
                    Mantém scan de contas + leitura do chat log ativa.
                  </div>
                </div>
                <button
                  onClick={() =>
                    void updateControls({
                      bridgeReaderEnabled: !controls.bridgeReaderEnabled,
                    })
                  }
                  className={`rounded px-4 py-2 text-xs font-bold ${
                    controls.bridgeReaderEnabled
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {controls.bridgeReaderEnabled ? "LIGADO" : "DESLIGADO"}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-100">Master GSE</div>
                  <div className="text-xs text-slate-500">
                    Se desligado, nenhuma janela recebe clique/tecla GSE.
                  </div>
                </div>
                <button
                  onClick={() =>
                    void updateControls({
                      gseMasterEnabled: !controls.gseMasterEnabled,
                    })
                  }
                  className={`rounded px-4 py-2 text-xs font-bold ${
                    controls.gseMasterEnabled
                      ? "bg-fuchsia-500 text-white"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {controls.gseMasterEnabled ? "GSE ON" : "GSE OFF"}
                </button>
              </div>
            </div>
          </div>

          {/* Combat-log relay toggle */}
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-slate-100">
                  🗡 Relay pelo combatlog (tempo real)
                </div>
                <div className="text-xs text-slate-500">
                  O addon espelha cada whisper como um emote no{" "}
                  <code>WoWCombatLog.txt</code>, que grava no disco quase
                  instantaneamente — resolve clientes onde o chatlog só atualiza
                  ao fechar o jogo. Requer <code>/combatlog</code> ativo (o
                  addon liga sozinho). ⚠ O emote fica visível para jogadores
                  próximos; desative aqui ou com <code>/wimbridge combat</code>{" "}
                  se incomodar.
                </div>
              </div>
              <button
                onClick={() =>
                  void updateControls({
                    combatRelayEnabled: !controls.combatRelayEnabled,
                  })
                }
                className={`rounded px-4 py-2 text-xs font-bold ${
                  controls.combatRelayEnabled
                    ? "bg-amber-500 text-slate-950"
                    : "bg-slate-700 text-slate-300"
                }`}
              >
                {controls.combatRelayEnabled ? "COMBAT ON" : "COMBAT OFF"}
              </button>
            </div>
          </div>

          {/* Voice relay toggle */}
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-slate-100">🎙 Modo voz (tempo real)</div>
                <div className="text-xs text-slate-500">
                  O addon fala cada whisper no jogo com os nomes soletrados em
                  alfabeto fonético; o bridge ouve pelo microfone e manda direto
                  para o site — funciona mesmo quando o WoW só grava o chatlog
                  ao fechar a janela. Requer{" "}
                  <code>pip install SpeechRecognition</code> (já incluso no
                  requirements) e um microfone ligado.
                </div>
              </div>
              <button
                onClick={() =>
                  void updateControls({
                    voiceRelayEnabled: !controls.voiceRelayEnabled,
                  })
                }
                className={`rounded px-4 py-2 text-xs font-bold ${
                  controls.voiceRelayEnabled
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-700 text-slate-300"
                }`}
              >
                {controls.voiceRelayEnabled ? "VOZ ON" : "VOZ OFF"}
              </button>
            </div>
          </div>

          {/* Close-chat toggle */}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-slate-100">
                  Fechar chat do jogo após enviar (Escape)
                </div>
                <div className="text-xs text-slate-500">
                  Fecha o campo de chat depois de cada whisper enviado para não
                  atrapalhar o GSE nem outras janelas. A próxima mensagem da
                  fila reabre o chat sozinha — você pode responder qualquer
                  pessoa depois, mesmo com o chat fechado.
                </div>
              </div>
              <button
                onClick={() =>
                  void updateControls({
                    whisperCloseChatEnabled: !controls.whisperCloseChatEnabled,
                  })
                }
                className={`rounded px-4 py-2 text-xs font-bold ${
                  controls.whisperCloseChatEnabled
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-700 text-slate-300"
                }`}
              >
                {controls.whisperCloseChatEnabled ? "LIGADO" : "DESLIGADO"}
              </button>
            </div>
          </div>

          {/* Timing controls grid */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-400">
              ⏱ Abrir chat no jogo
              <span className="ml-1 text-slate-600">(abrir /w)</span>
              <input
                type="number"
                min={0}
                max={3000}
                step={50}
                value={delayDraft.whisperChatOpenDelayMs}
                onChange={(e) =>
                  setDraftField("whisperChatOpenDelayMs", e.target.value)
                }
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              ⏱ Delay de foco antes de digitar
              <input
                type="number"
                min={100}
                max={5000}
                step={100}
                value={delayDraft.whisperFocusDelayMs}
                onChange={(e) =>
                  setDraftField("whisperFocusDelayMs", e.target.value)
                }
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              ⏱ Entre cada tecla digitada
              <span className="ml-1 text-slate-600">(typing)</span>
              <input
                type="number"
                min={10}
                max={500}
                step={1}
                inputMode="numeric"
                value={delayDraft.whisperKeystrokeDelayMs}
                onChange={(e) =>
                  setDraftField("whisperKeystrokeDelayMs", e.target.value)
                }
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              ⏱ Enviar mensagem (Enter)
              <input
                type="number"
                min={0}
                max={3000}
                step={50}
                value={delayDraft.whisperChatSendDelayMs}
                onChange={(e) =>
                  setDraftField("whisperChatSendDelayMs", e.target.value)
                }
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              ⏱ Fechar chat (Escape)
              <span className="ml-1 text-slate-600">(após enviar)</span>
              <input
                type="number"
                min={0}
                max={3000}
                step={50}
                value={delayDraft.whisperChatCloseDelayMs}
                onChange={(e) =>
                  setDraftField("whisperChatCloseDelayMs", e.target.value)
                }
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              ⏱ Depois de enviar whisper
              <input
                type="number"
                min={100}
                max={5000}
                step={100}
                value={delayDraft.whisperAfterSendDelayMs}
                onChange={(e) =>
                  setDraftField("whisperAfterSendDelayMs", e.target.value)
                }
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              ⏱ Poll da fila de whisper
              <input
                type="number"
                min={500}
                max={10000}
                step={100}
                value={delayDraft.queuePollMs}
                onChange={(e) => setDraftField("queuePollMs", e.target.value)}
                className="mt-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button
              onClick={() => void saveDelays()}
              disabled={!delayDirty}
              className="w-full rounded bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40 sm:w-auto"
            >
              💾 Salvar delays
            </button>
            {delayDirty ? (
              <span className="text-xs text-amber-300">
                alterações pendentes — clique em Salvar delays
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                delays salvos: foco {controls.whisperFocusDelayMs}ms · digitar{" "}
                {controls.whisperKeystrokeDelayMs}ms · enviar{" "}
                {controls.whisperChatSendDelayMs}ms · fechar{" "}
                {controls.whisperChatCloseDelayMs}ms · pós-envio{" "}
                {controls.whisperAfterSendDelayMs}ms
              </span>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              onClick={() => void bulk("startAll")}
              disabled={characters.length === 0 || !controls.gseMasterEnabled}
              className="w-full rounded-lg bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-40 sm:w-auto"
            >
              ▶ Iniciar TODOS ({characters.length})
            </button>
            <button
              onClick={() => void bulk("stopAll")}
              disabled={characters.length === 0}
              className="w-full rounded-lg bg-rose-500 px-6 py-3 text-sm font-bold text-white shadow hover:bg-rose-400 disabled:opacity-40 sm:w-auto"
            >
              ⏹ Parar TODOS
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            💡 O leitor pode ficar ligado com o GSE desligado. O GSE só roda
            quando <b>Master GSE</b> está ON e o personagem também está marcado
            como rodando.
          </p>
        </div>

        {/* Per-character table (scrolls horizontally on small screens) */}
        <div className="relative overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          {/* Scroll hint on mobile */}
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-900/80 to-transparent sm:hidden" />
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="bg-slate-900/60 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Personagem</th>
                <th className="px-4 py-3">Slot</th>
                <th className="px-4 py-3">Status janela</th>
                <th className="px-4 py-3">Tecla GSE</th>
                <th className="px-4 py-3">Intervalo</th>
                <th className="px-4 py-3">GSE</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {characters.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Nenhum personagem detectado. Abra o Bakers Whisper no seu
                    PC e clique em ▶ Iniciar.
                  </td>
                </tr>
              )}
              {characters.map((c) => {
                const win = windows.find((w) => w.character === c);
                const state = states[c] ?? {
                  character: c,
                  running: false,
                  keybind: "1",
                  intervalMs: 100,
                  updatedAt: new Date().toISOString(),
                };
                const dirty = charDirty[c];
                return (
                  <tr key={c} className="border-t border-slate-800/60">
                    <td className="px-4 py-3 font-mono text-sm text-emerald-300">
                      <span className="inline-flex items-center gap-1.5">
                        {c}
                        {dirty && (
                          <span
                            className="h-2 w-2 rounded-full bg-amber-400"
                            title="Alteração não salva"
                          />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {win?.slot ? (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
                          wow{win.slot}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            win?.online ? "bg-emerald-400" : "bg-slate-600"
                          }`}
                        />
                        <span
                          className={`text-xs ${
                            win?.online ? "text-emerald-300" : "text-slate-500"
                          }`}
                        >
                          {win?.online ? "online" : "offline"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={state.keybind}
                        onChange={(e) =>
                          setCharField(c, "keybind", e.target.value.slice(0, 8))
                        }
                        placeholder="1"
                        className="w-16 rounded bg-slate-800 px-2 py-1 text-center font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={50}
                          max={2000}
                          step={10}
                          value={state.intervalMs}
                          onChange={(e) =>
                            setCharField(c, "intervalMs", e.target.value)
                          }
                          className="w-20 rounded bg-slate-800 px-2 py-1 text-right font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500/60"
                        />
                        <span className="text-xs text-slate-500">ms</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          void updateOne(c, { running: !state.running })
                        }
                        disabled={
                          busy[c] ||
                          (!controls.gseMasterEnabled && !state.running)
                        }
                        title={
                          !controls.gseMasterEnabled && !state.running
                            ? "Ligue o Master GSE primeiro"
                            : undefined
                        }
                        className={`rounded-lg px-4 py-2 text-xs font-bold shadow transition disabled:opacity-40 ${
                          state.running
                            ? "bg-rose-500 text-white hover:bg-rose-400"
                            : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                        }`}
                      >
                        {state.running ? "⏹ parar" : "▶ iniciar"}
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={() => void removeCharacter(c)}
                        disabled={removing[c]}
                        className="rounded p-1.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                        title={`Remover ${c}`}
                        aria-label={`Remover ${c}`}
                      >
                        {removing[c] ? "..." : "✕"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Save all character changes */}
        {hasCharDirty && (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void saveAllCharChanges()}
              disabled={savingChars}
              className="w-full rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 shadow hover:bg-amber-400 disabled:opacity-40 sm:w-auto"
            >
              {savingChars ? "salvando..." : "💾 Salvar alterações dos personagens"}
            </button>
            <span className="text-xs text-amber-300">
              tecla/intervalo alterado(s) — salve para aplicar no bridge
            </span>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100">
          <b className="text-amber-300">Como configurar o GSE:</b>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Instale o addon <b>GSE - Advanced Macros</b> no CurseForge/WoWUp
              e crie sua sequência.
            </li>
            <li>
              No WoW, arraste a macro do GSE para a barra de ação e{" "}
              <b>anote em qual tecla ela está</b> (ex. <code>1</code>,{" "}
              <code>F1</code>, <code>NUMPAD1</code>).
            </li>
            <li>
              Configure a mesma tecla no campo <b>&quot;Tecla GSE&quot;</b>{" "}
              acima para cada personagem.
            </li>
            <li>
              Clique ▶ iniciar. O Python vai spammar essa tecla em background.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
