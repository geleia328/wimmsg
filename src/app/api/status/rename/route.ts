import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST → rename a window's character/slot to avoid conflicts across PCs.
 * Body: { hwnd: string, character?: string, slot?: string }
 *
 * This allows the user to manually set a unique character name or slot
 * for each WoW window, preventing collisions when running the bridge
 * on multiple PCs simultaneously.
 */
export async function POST(request: NextRequest) {
  let payload: { hwnd?: string; id?: number; character?: string; slot?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload.hwnd && !payload.id) {
    return NextResponse.json({ error: "missing_hwnd_or_id" }, { status: 400 });
  }

  const set: Record<string, unknown> = { lastSeen: new Date() };
  if (typeof payload.character === "string") {
    set.character = payload.character.trim();
  }
  if (typeof payload.slot === "string") {
    set.slot = payload.slot.trim();
  }

  if (Object.keys(set).length <= 1) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  let updated;
  if (payload.hwnd) {
    [updated] = await db
      .update(clientWindows)
      .set(set)
      .where(eq(clientWindows.hwnd, payload.hwnd))
      .returning({ id: clientWindows.id });
  } else if (payload.id) {
    [updated] = await db
      .update(clientWindows)
      .set(set)
      .where(eq(clientWindows.id, payload.id))
      .returning({ id: clientWindows.id });
  }

  if (!updated) {
    return NextResponse.json({ error: "window_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: updated.id });
}
