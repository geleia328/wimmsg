import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, asc, eq, gt, sql, or } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  → messages between `character` (your window) and `player` (the other end).
 * POST → queues a new outgoing whisper to be typed in that specific window.
 *
 * The search is bidirectional so the chat behaves like a social network:
 * it shows all messages exchanged between the two parties regardless of
 * which side is the "owner" (character) or "other" (player).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ character: string; player: string }> },
) {
  const { character: rawChar, player: rawPlayer } = await context.params;
  const character = decodeURIComponent(rawChar);
  const player = decodeURIComponent(rawPlayer);
  const since = Number.parseInt(
    request.nextUrl.searchParams.get("since") ?? "0",
    10,
  );

  const conditions = [
    or(
      and(
        eq(messages.character, character),
        eq(messages.player, player),
      ),
      and(
        eq(messages.character, player),
        eq(messages.player, character),
      ),
    ),
  ];
  if (Number.isFinite(since) && since > 0) {
    conditions.push(gt(messages.id, since));
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.createdAt))
    .limit(500);

  return NextResponse.json({ character, player, messages: rows });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ character: string; player: string }> },
) {
  const { character: rawChar, player: rawPlayer } = await context.params;
  const character = decodeURIComponent(rawChar).trim();
  const player = decodeURIComponent(rawPlayer).trim();

  let payload: { body?: string } = {};
  try {
    payload = (await request.json()) as { body?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = (payload.body ?? "").trim();
  if (!player || !body || !character) {
    return NextResponse.json(
      { error: "character, player and body required" },
      { status: 400 },
    );
  }
  if (body.length > 255) {
    return NextResponse.json(
      { error: "message too long (255 char max)" },
      { status: 400 },
    );
  }

  // Detect potential realm mismatch: WoW whispers only work between the same
  // realm or across officially connected realms. We can't know the connected
  // realm groups, but we can flag when suffixes differ.
  const charRealm = character.includes("-")
    ? character.split("-").slice(-1)[0].toLowerCase()
    : "";
  const playerRealm = player.includes("-")
    ? player.split("-").slice(-1)[0].toLowerCase()
    : "";
  const realmWarning =
    charRealm && playerRealm && charRealm !== playerRealm
      ? `Personagem está em ${character.split("-").slice(-1)[0]} mas o destinatário está em ${player.split("-").slice(-1)[0]}. O envio pode falhar se os servidores não estiverem conectados.`
      : undefined;

  const [inserted] = await db
    .insert(messages)
    .values({
      character,
      player,
      body,
      direction: "outgoing",
      status: "pending",
      externalId: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();

  return NextResponse.json({ message: inserted, warning: realmWarning });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ character: string; player: string }> },
) {
  const { character: rawChar, player: rawPlayer } = await context.params;
  const character = decodeURIComponent(rawChar).trim();
  const player = decodeURIComponent(rawPlayer).trim();

  if (!character || !player) {
    return NextResponse.json(
      { error: "character and player required" },
      { status: 400 },
    );
  }

  const deleted = await db
    .delete(messages)
    .where(
      or(
        and(eq(messages.character, character), eq(messages.player, player)),
        and(eq(messages.character, player), eq(messages.player, character)),
      ),
    )
    .returning({ id: messages.id });

  return NextResponse.json({
    ok: true,
    character,
    player,
    deletedCount: deleted.length,
  });
}
