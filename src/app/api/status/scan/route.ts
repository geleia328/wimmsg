import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { normalizeNameForStorage } from "@/lib/unicode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WindowPayload = {
  character?: string;
  windowTitle?: string;
  pid?: string;
  hwnd?: string;
  foreground?: string | boolean;
  matched?: string | boolean;
  slot?: string | number;
  realm?: string;
};

function yesNo(value: string | boolean | undefined): "yes" | "no" {
  return value === true || value === "yes" || value === "true" ? "yes" : "no";
}

/**
 * O bridge envia aqui a lista de janelas do WoW abertas no PC.
 *
 * Importante: NUNCA apagamos uma janela automaticamente. A regra de
 * "online" é derivada do `lastSeen` (ver /api/status). Janelas que o
 * bridge para de reportar continuam registradas — só viram "offline"
 * depois de ONLINE_BY_SCAN_MS sem update. Isso evita o bug onde o
 * bridge tinha um hiccup de 5s e a janela piscava offline mesmo com
 * o WoW aberto.
 *
 * Se a janela tem `hwnd` repetido entre scans, atualizamos
 * (onConflictDoUpdate). Janelas novas são inseridas.
 */
export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  let payload: { windows?: WindowPayload[] } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const incoming = Array.isArray(payload.windows) ? payload.windows : [];
  let upserted = 0;
  const seenHwnds = new Set<string>();

  for (const w of incoming) {
    if (!w.hwnd && !w.windowTitle) continue;
    const hwnd = (w.hwnd ?? w.pid ?? w.windowTitle ?? "").trim();
    if (!hwnd) continue;
    seenHwnds.add(hwnd);

    const slot = w.slot === undefined ? "" : String(w.slot);
    const values = {
      character: w.character ? normalizeNameForStorage(w.character) : "",
      windowTitle: w.windowTitle ?? "",
      pid: w.pid ?? "",
      hwnd,
      foreground: yesNo(w.foreground),
      matched: yesNo(w.matched),
      slot,
      realm: w.realm ?? "",
      lastSeen: new Date(),
    };
    await db
      .insert(clientWindows)
      .values(values)
      .onConflictDoUpdate({
        target: clientWindows.hwnd,
        set: values,
      });
    upserted += 1;
  }

  return NextResponse.json({
    ok: true,
    upserted,
    reportedHwnds: seenHwnds.size,
  });
}
