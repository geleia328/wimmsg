import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingPayload = {
  messages: Array<{
    externalId?: string;
    character: string;
    player: string;
    body: string;
    receivedAt?: string;
  }>;
};

/**
 * The Python bridge posts newly-seen whispers here. `character` identifies
 * WHICH of your WoW windows received the whisper. We upsert by external_id
 * so re-posting is idempotent.
 */
export async function POST(request: NextRequest) {
  const guard = checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  let payload: IncomingPayload;
  try {
    payload = (await request.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload || !Array.isArray(payload.messages)) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const rows = payload.messages
    .filter(
      (m) =>
        m &&
        typeof m.player === "string" &&
        typeof m.body === "string" &&
        typeof m.character === "string",
    )
    .map((m) => ({
      character: m.character.trim() || "unknown",
      player: m.player.trim(),
      body: m.body,
      direction: "incoming" as const,
      status: "received" as const,
      externalId:
        m.externalId ??
        `${m.character}-${m.player}-${m.receivedAt ?? new Date().toISOString()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      createdAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
    }))
    .filter((r) => r.player.length > 0 && r.body.length > 0);

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const inserted = await db
    .insert(messages)
    .values(rows)
    .onConflictDoNothing({ target: messages.externalId })
    .returning({ id: messages.id });

  return NextResponse.json({ inserted: inserted.length, received: rows.length });
}

export async function GET() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages);
  return NextResponse.json({ ok: true, totalMessages: count });
}
