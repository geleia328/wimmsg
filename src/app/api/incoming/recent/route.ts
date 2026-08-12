import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows, messages } from "@/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the latest incoming whispers globally (any character, any player).
 * Supports `?since=<id>` so the UI can poll for "new since last check" and
 * fire notifications only for messages it hasn't seen before.
 *
 * Enriched with the current `slot` and `windowTitle` for the character that
 * received the whisper, so the UI can notify "veio do wow2".
 */
export async function GET(request: NextRequest) {
  const since = Number.parseInt(
    request.nextUrl.searchParams.get("since") ?? "0",
    10,
  );

  const conditions = [eq(messages.direction, "incoming")];
  if (Number.isFinite(since) && since > 0) {
    conditions.push(gt(messages.id, since));
  }

  const rows = await db
    .select({
      id: messages.id,
      character: messages.character,
      player: messages.player,
      body: messages.body,
      createdAt: messages.createdAt,
      slot: clientWindows.slot,
      windowTitle: clientWindows.windowTitle,
    })
    .from(messages)
    .leftJoin(clientWindows, eq(clientWindows.character, messages.character))
    .where(and(...conditions))
    .orderBy(desc(messages.id))
    .limit(50);

  return NextResponse.json({
    messages: rows.reverse(),
    latestId: rows.length > 0 ? Math.max(...rows.map((r) => r.id)) : since,
  });
}
