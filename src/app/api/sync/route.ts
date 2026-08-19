import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncPayload = {
  messages?: Array<{
    externalId?: string;
    character?: string;
    player?: string;
    body?: string;
    receivedAt?: string;
    direction?: "incoming" | "outgoing";
    status?: string;
  }>;
};

/**
 * Historical/live sync endpoint used by BakersWhisper.exe.
 * It accepts the same format as /api/ingest, but exists separately because
 * older bridge builds call /api/sync when reading the last lines from
 * WoWChatLog.txt at startup. Without this route, history sync silently fails.
 */
export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  let payload: SyncPayload;
  try {
    payload = (await request.json()) as SyncPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  const rows = raw
    .filter(
      (m) =>
        typeof m.character === "string" &&
        typeof m.player === "string" &&
        typeof m.body === "string" &&
        m.player.trim() &&
        m.body.trim(),
    )
    .map((m) => {
      const direction = m.direction === "outgoing" ? ("outgoing" as const) : ("incoming" as const);
      const character = (m.character ?? "unknown").trim().toLowerCase() || "unknown";
      const player = (m.player ?? "").trim().toLowerCase();
      const body = (m.body ?? "").trim();
      const createdAt = m.receivedAt ? new Date(m.receivedAt) : new Date();
      return {
        character,
        player,
        body,
        direction,
        status:
          direction === "outgoing"
            ? ((m.status ?? "sent") as "sent" | "pending" | "failed")
            : ("received" as const),
        externalId:
          m.externalId ??
          `sync-${character}-${player}-${createdAt.toISOString()}-${body.slice(0, 16)}`,
        createdAt,
      };
    });

  if (rows.length === 0) return NextResponse.json({ inserted: 0, received: 0 });

  const uniqueRows = await filterDuplicateContent(rows);
  if (uniqueRows.length === 0) {
    return NextResponse.json({ inserted: 0, received: rows.length });
  }

  const inserted = await db
    .insert(messages)
    .values(uniqueRows)
    .onConflictDoNothing({ target: messages.externalId })
    .returning({ id: messages.id });

  return NextResponse.json({ inserted: inserted.length, received: rows.length });
}

export async function GET() {
  const [row] = await db.select({ count: sql`count(*)::int` }).from(messages);
  return NextResponse.json({ ok: true, totalMessages: row?.count ?? 0 });
}
