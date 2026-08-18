import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
import { eq, and, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncPayload = {
  messages: Array<{
    externalId?: string;
    character: string;
    player: string;
    body: string;
    direction?: "incoming" | "outgoing";
    status?: string;
    receivedAt?: string;
  }>;
};

type ParsedRelay = {
  direction: "incoming" | "outgoing";
  character: string;
  player: string;
  body: string;
};

function parseEmbeddedRelay(body: string): ParsedRelay | null {
  const from = body.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY)<OWN:([^>]+)><FROM:([^>]+)>(?:<TS:[^>]+>)?(.*)$/,
  );
  if (from) {
    return {
      direction: "incoming",
      character: from[1].trim(),
      player: from[2].trim(),
      body: from[3].trim(),
    };
  }
  const to = body.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY)<OWN:([^>]+)><TO:([^>]+)>(?:<TS:[^>]+>)?(.*)$/,
  );
  if (to) {
    return {
      direction: "outgoing",
      character: to[1].trim(),
      player: to[2].trim(),
      body: to[3].trim(),
    };
  }
  return null;
}

/**
 * POST /api/sync — bridge sends historical messages from log file
 * GET  /api/sync — returns last 50 messages for a character (for UI refresh)
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
    .map((m) => {
      const relay = parseEmbeddedRelay(m.body);
      const character = (relay?.character ?? m.character.trim()) || "unknown";
      const player = relay?.player ?? m.player.trim();
      const body = relay?.body ?? m.body;
      const direction = relay?.direction ?? m.direction ?? "incoming";
      const isOutgoing = direction === "outgoing";
      return {
        character,
        player,
        body,
        direction: isOutgoing ? ("outgoing" as const) : ("incoming" as const),
        status: isOutgoing
          ? ((m.status ?? "sent") as "sent" | "failed")
          : ("received" as const),
        externalId:
          m.externalId ??
          `sync-${character}-${player}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        createdAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
      };
    })
    .filter((r) => r.player.length > 0 && r.body.length > 0);

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  // Never duplicate history on repeated "Iniciar" clicks.
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

export async function GET(request: NextRequest) {
  const character = request.nextUrl.searchParams.get("character");
  const player = request.nextUrl.searchParams.get("player");
  const limit = Math.min(
    100,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "50")),
  );

  const conditions = [];
  if (character) {
    conditions.push(eq(messages.character, character));
  }
  if (player) {
    conditions.push(eq(messages.player, player));
  }

  const rows = await db
    .select({
      id: messages.id,
      character: messages.character,
      player: messages.player,
      body: messages.body,
      direction: messages.direction,
      status: messages.status,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${messages.createdAt} desc`)
    .limit(limit);

  return NextResponse.json({
    messages: rows.reverse(), // oldest first
  });
}
