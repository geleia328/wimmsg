import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";

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
 * POST → the Python bridge upserts the windows it currently sees. We key by
 * `hwnd` (unique). Any window that isn't posted this round is left stale and
 * the UI treats `last_seen` older than ~15s as offline.
 *
 * If no `windows` array is supplied, we just touch last_seen for existing rows
 * so the bridge can keep them "fresh" while scanning.
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

  for (const w of incoming) {
    if (!w.hwnd && !w.windowTitle) continue;
    const hwnd = w.hwnd ?? w.pid ?? w.windowTitle ?? "";
    const slot = w.slot === undefined ? "" : String(w.slot);
    await db
      .insert(clientWindows)
      .values({
        character: w.character ?? "",
        windowTitle: w.windowTitle ?? "",
        pid: w.pid ?? "",
        hwnd,
        foreground: yesNo(w.foreground),
        matched: yesNo(w.matched),
        slot,
        realm: w.realm ?? "",
        lastSeen: new Date(),
      })
      .onConflictDoUpdate({
        target: clientWindows.hwnd,
        set: {
          character: w.character ?? "",
          windowTitle: w.windowTitle ?? "",
          pid: w.pid ?? "",
          foreground: yesNo(w.foreground),
          matched: yesNo(w.matched),
          slot,
          realm: w.realm ?? "",
          lastSeen: new Date(),
        },
      });
    upserted++;
  }

  return NextResponse.json({ ok: true, upserted });
}
