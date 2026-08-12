import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns all currently detected WoW windows plus a computed `online` flag
 * (true when last_seen is within the last 15 seconds).
 */
export async function GET() {
  const rows = await db
    .select()
    .from(clientWindows)
    .orderBy(desc(clientWindows.lastSeen));

  const now = Date.now();
  const windows = rows.map((r) => {
    const seen = new Date(r.lastSeen).getTime();
    return {
      id: r.id,
      character: r.character,
      windowTitle: r.windowTitle,
      pid: r.pid,
      hwnd: r.hwnd,
      foreground: r.foreground === "yes",
      matched: r.matched === "yes",
      lastSeen: r.lastSeen,
      online: now - seen < 15_000,
      secondsAgo: Math.max(0, Math.floor((now - seen) / 1000)),
    };
  });

  return NextResponse.json({ windows });
}
