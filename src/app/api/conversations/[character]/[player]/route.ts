import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getKnownOwnCharacters } from "@/lib/ownCharacters";
import { and, asc, eq, gt } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  → messages between `character` (your window) and `player` (the other end).
 * POST → queues a new outgoing whisper to be typed in that specific window.
 *        If `player` is ANOTHER OF YOUR OWN characters (multi-boxing), the
 *        incoming side is mirrored immediately so the destination chat shows
 *        the message in real time — no need to wait for the bridge to read
 *        the in-game echo.
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
    eq(messages.player, player),
    eq(messages.character, character),
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

  const outgoingId = `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [inserted] = await db
    .insert(messages)
    .values({
      character,
      player,
      body,
      direction: "outgoing",
      status: "pending",
      externalId: outgoingId,
    })
    .returning();

  // ---- MIRROR: destination is another of the user's own characters ----
  // Detect own characters from every bridge source. Do NOT require
  // `matched = yes`: while a window is being rescanned/renamed the bridge can
  // temporarily report matched=no even though its `character` is already
  // known. Requiring matched=yes was why "salve" stayed only on the sender
  // side in the user's screenshot.
  let mirrored = false;
  let mirrorReason = "";
  const target = player.trim().toLowerCase();
  if (target !== character.toLowerCase()) {
    let known = new Set<string>();
    try {
      known = await getKnownOwnCharacters();
    } catch {
      /* mirror is best-effort — the outgoing row remains safe */
    }

    if (known.has(target)) {
      await db
        .insert(messages)
        .values({
          character: player.trim(),
          player: character,
          body,
          direction: "incoming",
          status: "received",
          externalId: `mirror-${outgoingId}`,
        })
        .onConflictDoNothing({ target: messages.externalId });
      mirrored = true;
      mirrorReason = "detected_own_character";
    }
  }

  // Return this diagnostic so the UI/bridge logs can immediately show why a
  // self-character message was or was not mirrored.
  if (!mirrored && target !== character.toLowerCase()) {
    mirrorReason = "destination_not_registered_as_own_character";
  }

  return NextResponse.json({
    message: inserted,
    warning: realmWarning,
    mirrored,
    mirrorReason,
  });
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
    .where(and(eq(messages.character, character), eq(messages.player, player)))
    .returning({ id: messages.id });

  return NextResponse.json({
    ok: true,
    character,
    player,
    deletedCount: deleted.length,
  });
}
