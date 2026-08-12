import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanPayload = {
  scannedAt?: string;
  windows: Array<{
    character?: string;
    windowTitle: string;
    pid?: string | number;
    hwnd: string | number;
    foreground?: boolean;
    matched?: boolean;
  }>;
};

/**
 * The Python bridge posts here every N seconds with the full list of WoW
 * windows currently open on the machine. We UPSERT each row by hwnd and
 * remove rows we haven't seen for > 30s (garbage collection of closed
 * windows).
 */
export async function POST(request: NextRequest) {
  const guard = checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  let payload: ScanPayload;
  try {
    payload = (await request.json()) as ScanPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!payload || !Array.isArray(payload.windows)) {
    return NextResponse.json({ error: "missing_windows" }, { status: 400 });
  }

  const now = new Date();
  const rows = payload.windows
    .filter((w) => w && w.hwnd !== undefined && w.hwnd !== null)
    .map((w) => ({
      character: (w.character ?? "").trim(),
      windowTitle: (w.windowTitle ?? "").slice(0, 255),
      pid: String(w.pid ?? ""),
      hwnd: String(w.hwnd),
      foreground: w.foreground ? "yes" : "no",
      matched: w.matched ? "yes" : "no",
      lastSeen: now,
    }));

  if (rows.length > 0) {
    // Upsert one at a time — small N, keeps SQL simple. For 20+ windows this
    // is still trivially fast.
    for (const r of rows) {
      await db
        .insert(clientWindows)
        .values(r)
        .onConflictDoUpdate({
          target: clientWindows.hwnd,
          set: {
            character: r.character,
            windowTitle: r.windowTitle,
            pid: r.pid,
            foreground: r.foreground,
            matched: r.matched,
            lastSeen: now,
          },
        });
    }
  }

  // Garbage-collect windows we haven't seen for > 30s (closed clients).
  await db.execute(
    sql/* sql */ `DELETE FROM ${clientWindows} WHERE last_seen < now() - interval '30 seconds'`,
  );

  return NextResponse.json({ ok: true, upserted: rows.length });
}
