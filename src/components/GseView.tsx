"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type GseChar = {
  character: string;
  running: string;
  keybind: string;
  intervalMs: string;
};

type Settings = Record<string, string>;

export default function GseView() {
  const [chars, setChars] = useState<GseChar[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [newChar, setNewChar] = useState("");
  const [saving, setSaving] = useState(false);
  const charDirtyRef = useRef<Set<string>>(new Set());
  const settingsDirtyRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([
        fetch("/api/gse", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/control", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (g?.ok) {
        setChars((prev) => {
          // Preserve user edits during polling: don't overwrite dirty rows
          const dirty = charDirtyRef.current;
          const server = (g.characters || []) as GseChar[];
          const next: GseChar[] = server.map((sc) => {
            if (dirty.has(sc.character.toLowerCase())) {
              const local = prev.find((p) => p.character.toLowerCase() === sc.character.toLowerCase());
              if (local) return local;
            }
            return sc;
          });
          // Keep local-only (unsaved new) characters
          for (const p of prev) {
            if (!next.find((n) => n.character.toLowerCase() === p.character.toLowerCase())) {
              if (dirty.has(p.character.toLowerCase())) next.push(p);
            }
          }
          return next;
        });
      }
      if (s?.ok) {
        setSettings((prev) => {
          const dirty = settingsDirtyRef.current;
          const server = s.settings || {};
          const next = { ...server };
          for (const k of Object.keys(prev)) {
            if (dirty.has(k)) next[k] = prev[k];
          }
          return next;
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const setChar = (name: string, patch: Partial<GseChar>) => {
    charDirtyRef.current.add(name.toLowerCase());
    setChars((prev) => prev.map((c) => (c.character.toLowerCase() === name.toLowerCase() ? { ...c, ...patch } : c)));
  };

  const setSetting = (k: string, v: string) => {
    settingsDirtyRef.current.add(k);
    setSettings((prev) => ({ ...prev, [k]: v }));
  };

  const addChar = () => {
    const c = newChar.trim();
    if (!c) return;
    if (chars.find((x) => x.character.toLowerCase() === c.toLowerCase())) return;
    charDirtyRef.current.add(c.toLowerCase());
    setChars((prev) => [...prev, { character: c, running: "no", keybind: "1", intervalMs: "120" }]);
    setNewChar("");
  };

  const removeChar = async (name: string) => {
    if (!confirm(`Remover ${name} do GSE?`)) return;
    try {
      await fetch(`/api/gse/${encodeURIComponent(name)}`, { method: "DELETE" });
      charDirtyRef.current.delete(name.toLowerCase());
      setChars((prev) => prev.filter((c) => c.character.toLowerCase() !== name.toLowerCase()));
    } catch { /* ignore */ }
  };

  const toggleRun = (c: GseChar) => {
    setChar(c.character, { running: c.running === "yes" ? "no" : "yes" });
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      // Save chars
      await fetch("/api/gse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characters: chars }),
      });
      // Save settings
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      charDirtyRef.current.clear();
      settingsDirtyRef.current.clear();
      await load();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const masterOn = settings.gse_master_enabled === "yes";
  const readerOn = settings.bridge_reader_enabled === "yes";
  const closeChat = settings.whisper_close_chat_enabled === "yes";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GSE / Spammers</h1>
          <p className="mt-1 text-sm text-slate-400">
            Controle centralizado dos personagens spammando macro GSE e do leitor de whispers.
          </p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "💾 Salvar alterações"}
        </button>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <span className="text-sm">
            <div className="font-medium">Master GSE</div>
            <div className="text-xs text-slate-400">liga/desliga todos spammers</div>
          </span>
          <input
            type="checkbox"
            checked={masterOn}
            onChange={(e) => setSetting("gse_master_enabled", e.target.checked ? "yes" : "no")}
            className="h-5 w-5 accent-emerald-500"
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <span className="text-sm">
            <div className="font-medium">Leitor de whispers</div>
            <div className="text-xs text-slate-400">bridge lê WoWChatLog</div>
          </span>
          <input
            type="checkbox"
            checked={readerOn}
            onChange={(e) => setSetting("bridge_reader_enabled", e.target.checked ? "yes" : "no")}
            className="h-5 w-5 accent-emerald-500"
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <span className="text-sm">
            <div className="font-medium">Fechar chat após enviar</div>
            <div className="text-xs text-slate-400">envia ESC ao final</div>
          </span>
          <input
            type="checkbox"
            checked={closeChat}
            onChange={(e) => setSetting("whisper_close_chat_enabled", e.target.checked ? "yes" : "no")}
            className="h-5 w-5 accent-emerald-500"
          />
        </label>
      </section>

      <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-medium">Delays de envio (ms)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["whisper_focus_delay_ms", "Foco na janela"],
            ["whisper_chat_open_delay_ms", "Abrir chat (Enter)"],
            ["whisper_keystroke_delay_ms", "Entre teclas"],
            ["whisper_chat_send_delay_ms", "Antes de enviar (Enter final)"],
            ["whisper_after_send_delay_ms", "Depois de enviar"],
            ["whisper_chat_close_delay_ms", "Antes de fechar (ESC)"],
            ["queue_poll_ms", "Poll da fila"],
          ].map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-xs uppercase text-slate-400">{label}</span>
              <input
                type="number"
                min={0}
                value={settings[k] ?? ""}
                onChange={(e) => setSetting(k, e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-lg font-medium">Personagens</h2>
          <div className="flex gap-2">
            <input
              value={newChar}
              onChange={(e) => setNewChar(e.target.value)}
              placeholder="ex: Juper-Azralon"
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button onClick={addChar} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500">
              + Adicionar
            </button>
          </div>
        </div>
        <div className="scroll-x">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Personagem</th>
                <th className="px-3 py-2">Keybind</th>
                <th className="px-3 py-2">Intervalo (ms)</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {chars.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    Nenhum personagem configurado.
                  </td>
                </tr>
              )}
              {chars.map((c) => (
                <tr key={c.character} className="border-t border-slate-800">
                  <td className="px-3 py-2 font-medium">{c.character}</td>
                  <td className="px-3 py-2">
                    <input
                      value={c.keybind}
                      onChange={(e) => setChar(c.character, { keybind: e.target.value })}
                      className="w-24 rounded-lg bg-slate-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={20}
                      value={c.intervalMs}
                      onChange={(e) => setChar(c.character, { intervalMs: e.target.value })}
                      className="w-28 rounded-lg bg-slate-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {c.running === "yes" ? (
                      <span className="rounded bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">rodando</span>
                    ) : (
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-500">parado</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => toggleRun(c)}
                      className={`mr-2 rounded-lg px-3 py-1 text-xs ${c.running === "yes" ? "bg-red-900/50 text-red-200 hover:bg-red-900" : "bg-emerald-700 hover:bg-emerald-600"}`}
                    >
                      {c.running === "yes" ? "⏹ Parar" : "▶ Iniciar"}
                    </button>
                    <button
                      onClick={() => removeChar(c.character)}
                      className="rounded-lg bg-slate-800 px-3 py-1 text-xs hover:bg-red-900"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
