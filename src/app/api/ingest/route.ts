import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getKnownOwnCharacters } from "@/lib/ownCharacters";
import { checkBridgeAuth } from "@/lib/auth";
import { and, eq, gt, like, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingPayload = {
  messages: Array<{
    externalId?: string;
    character: string;
    player: string;
    body: string;
    receivedAt?: string;
    /** incoming = received in the WoW window; outgoing = typed in WoW. */
    direction?: "incoming" | "outgoing";
    status?: string;
  }>;
};

/**
 * Bridge ingestion for both directions of the game chat.
 *
 * For outgoing lines typed directly in WoW, if the recipient is another known
 * own character, we immediately create the opposite incoming side too. This
 * makes two of the user's WoW windows behave like one normal messenger thread
 * even before the recipient's chat log gets tailed.
 */
export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
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
    .map((m) => {
      const isOutgoing = m.direction === "outgoing";
      return {
        character: m.character.trim() || "unknown",
        player: m.player.trim(),
        body: m.body.trim(),
        direction: isOutgoing ? ("outgoing" as const) : ("incoming" as const),
        status: isOutgoing
          ? ((m.status ?? "sent") as "sent" | "failed")
          : ("received" as const),
        externalId:
          m.externalId ??
          `${m.character}-${m.player}-${m.receivedAt ?? new Date().toISOString()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        createdAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
      };
    })
    .filter((r) => r.player.length > 0 && r.body.length > 0);

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, received: 0 });
  }

  // A site-originated self-character message is mirrored before the bridge
  // sees the game echo. Remove the later incoming echo from this request.
  const mirrorSince = new Date(Date.now() - 120_000);
  const mirrors = await db
    .select({
      character: messages.character,
      player: messages.player,
      body: messages.body,
    })
    .from(messages)
    .where(
      and(
        like(messages.externalId, "mirror-%"),
        eq(messages.direction, "incoming"),
        gt(messages.createdAt, mirrorSince),
      ),
    );
  const mirrorSet = new Set(
    mirrors.map(
      (m) =>
        `${m.character.toLowerCase()}|${m.player.toLowerCase()}|${m.body}`,
    ),
  );

  const filteredRows = rows.filter(
    (r) =>
      !(
        r.direction === "incoming" &&
        mirrorSet.has(
          `${r.character.toLowerCase()}|${r.player.toLowerCase()}|${r.body}`,
        )
      ),
  );

  // Direct game → game self-chat: outgoing from A to B also appears incoming
  // in B's conversation with A immediately. We intentionally use the helper
  // without `matched=yes`; a bridge rescan can temporarily clear that flag.
  let ownCharacters = new Set<string>();
  try {
    ownCharacters = await getKnownOwnCharacters();
  } catch {
    /* regular third-party ingestion still works if discovery is unavailable */
  }

  const mirroredRows = filteredRows
    .filter(
      (r) =>
        r.direction === "outgoing" &&
        r.player.toLowerCase() !== r.character.toLowerCase() &&
        ownCharacters.has(r.player.toLowerCase()),
    )
    .map((r) => ({
      character: r.player,
      player: r.character,
      body: r.body,
      direction: "incoming" as const,
      status: "received" as const,
      externalId: `mirror-${r.externalId}`,
      createdAt: r.createdAt,
    }));

  const allRows = [...filteredRows, ...mirroredRows];
  if (allRows.length === 0) {
    return NextResponse.json({ inserted: 0, received: rows.length });
  }

  const inserted = await db
    .insert(messages)
    .values(allRows)
    .onConflictDoNothing({ target: messages.externalId })
    .returning({ id: messages.id });

  return NextResponse.json({
    inserted: inserted.length,
    received: rows.length,
    mirrored: mirroredRows.length,
  });
}

export async function GET() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages);
  return NextResponse.json({ ok: true, totalMessages: count });
}
