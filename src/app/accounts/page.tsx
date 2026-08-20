"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type WindowStatus = {
  id: number;
  character: string;
  windowTitle: string;
  pid: string;
  hwnd: string;
  foreground: string;
  matched: string;
  slot: string;
  realm: string;
  lastSeen: string;
};

type EditingWindow = {
  id: number;
  character: string;
  slot: string;
};

export default function AccountsPage() {
  const [windows, setWindows] = useState<WindowStatus[]>([]);
  const [editing, setEditing] = useState<EditingWindow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { windows: WindowStatus[] };
          setWindows(data.windows);
        }
      } catch {
        // ignore
      }
    };
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  const startEdit = (w: WindowStatus) => {
    setEditing({ id: w.id, character: w.character, slot: w.slot });
    setSaveMsg("");
  };

  const cancelEdit = () => {
    setEditing(null);
    setSaveMsg("");
  };

  const saveEdit = async () => {
    if (!editing || saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const target = windows.find((w) => w.id === editing.id);
      if (!target) return;

      const res = await fetch("/api/status/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hwnd: target.hwnd,
          id: target.id,
          character: editing.character,
          slot: editing.slot,
        }),
      });
      if (res.ok) {
        setSaveMsg("✅ Salvo!");
        setWindows((prev) =>
          prev.map((w) =>
            w.id === editing.id
              ? { ...w, character: editing.character, slot: editing.slot }
              : w,
          ),
        );
        setEditing(null);
      } else {
        setSaveMsg("❌ Erro ao salvar");
      }
    } catch {
      setSaveMsg("❌ Falha na conexão");
    } finally {
      setSaving(false);
    }
  };

  const now = Date.now();

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-amber-400 hover:text-amber-300">← Chat</Link>
        <h1 className="text-lg font-bold">📡 Contas / Janelas WoW</h1>
      </header>
      <div className="mx-auto max-w-4xl p-4">
        {/* Multi-PC info */}
        <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
          <h2 className="mb-1 text-sm font-bold text-sky-300">💡 Multi-PC</h2>
          <p className="text-xs text-slate-400">
            Se você roda o bridge em mais de um PC, edite o <strong>Nome</strong> e/ou <strong>Slot</strong> de cada janela
            para evitar que wow1 do PC-A e wow1 do PC-B tenham o mesmo identificador.
            Exemplo: &quot;Mage-PC1&quot;, &quot;Mage-PC2&quot; ou slots &quot;A1&quot;, &quot;B1&quot;.
          </p>
        </div>

        {windows.length === 0 ? (
          <p className="text-slate-500">Nenhuma janela WoW detectada. Inicie o Python bridge.</p>
        ) : (
          <div className="space-y-3">
            {windows.map((w) => {
              const ago = Math.floor((now - new Date(w.lastSeen).getTime()) / 1000);
              const online = ago < 15;
              const isEditing = editing?.id === w.id;

              return (
                <div
                  key={w.id}
                  className={`rounded-lg border p-4 ${online ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-700 bg-slate-800/50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-emerald-400" : "bg-slate-600"}`} />
                        {isEditing ? (
                          <input
                            value={editing.character}
                            onChange={(e) => setEditing({ ...editing, character: e.target.value })}
                            className="rounded bg-slate-700 px-2 py-1 text-sm font-bold outline-none focus:ring-1 focus:ring-amber-500/60"
                            placeholder="Nome do personagem"
                          />
                        ) : (
                          <span className="font-bold">{w.character || "Desconhecido"}</span>
                        )}
                        {w.realm && !isEditing && <span className="text-xs text-slate-400">({w.realm})</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <span>Janela: {w.windowTitle}</span>
                        <span>· PID: {w.pid}</span>
                        <span>· Slot: {isEditing ? (
                          <input
                            value={editing.slot}
                            onChange={(e) => setEditing({ ...editing, slot: e.target.value })}
                            className="inline-block w-16 rounded bg-slate-700 px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-amber-500/60"
                            placeholder="ex: A1"
                          />
                        ) : (
                          w.slot || "—"
                        )}</span>
                        <span>· {online ? `Online (${ago}s)` : `Offline (${ago}s)`}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {saving ? "..." : "Salvar"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(w)}
                          className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20"
                          title="Editar nome/slot desta janela"
                        >
                          ✏️ Editar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {saveMsg && <p className="mt-3 text-sm">{saveMsg}</p>}
      </div>
    </div>
  );
}
