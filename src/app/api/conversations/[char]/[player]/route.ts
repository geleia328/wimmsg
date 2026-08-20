import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, messages } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { filterDuplicateContent } from "@/lib/dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  → history for one (character, player) conversation, oldest → newest.
 * POST → user typed a reply on the website; queue it as `pending` so the
 *        Python bridge can type it into the matching WoW window.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ char: string; player: string }> },
) {
  const { char, player } = await params;
  const character = decodeURIComponent(char).toLowerCase();
  const targetPlayer = decodeURIComponent(player).toLowerCase();

  const history = await db
    .select({
      id: messages.id,
      character: messages.character,
      player: messages.player,
      direction: messages.direction,
      body: messages.body,
      status: messages.status,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.character, character),
        eq(messages.player, targetPlayer),
        sql`${messages.body} !~* '(no do canal|intervalo|flood\\s*&\\s*queue|status:\\s*desligado|criar link|exportar perfil|importar perfil|ligar sistema|todos os objetivos|missões|recompensas|comércio\\s*-\\s*cidade|guilda ativa|recruta dps|lf craft)'`,
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(500);

  return NextResponse.json({ messages: history });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ char: string; player: string }> },
) {
  const { char, player } = await params;
  const character = decodeURIComponent(char).toLowerCase();
  const targetPlayer = decodeURIComponent(player).toLowerCase();

  let payload: { body?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = (payload.body ?? "").trim();
  if (!body) {
    return NextResponse.json({ error: "empty_body" }, { status: 400 });
  }

  const row = {
    character,
    player: targetPlayer,
    body,
    direction: "outgoing" as const,
    status: "pending" as const,
    externalId: `web-${character}-${targetPlayer}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    createdAt: new Date(),
  };

  const unique = await filterDuplicateContent([row]);
  if (unique.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, reason: "duplicate" });
  }

  const [inserted] = await db
    .insert(messages)
    .values(unique)
    .onConflictDoNothing({ target: messages.externalId })
    .returning({ id: messages.id });

  return NextResponse.json({
    ok: true,
    inserted: inserted ? 1 : 0,
    id: inserted?.id ?? null,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ char: string; player: string }> },
) {
  const { char, player } = await params;
  const character = decodeURIComponent(char).toLowerCase();
  const targetPlayer = decodeURIComponent(player).toLowerCase();

  const deleted = await db
    .delete(messages)
    .where(
      and(
        sql`lower(${messages.character}) = ${character}`,
        sql`lower(${messages.player}) = ${targetPlayer}`,
      ),
    )
    .returning({ id: messages.id });

  // Tombstone: prevents OCR/bridge from immediately re-inserting the same
  // conversation while the same relay strip is still visible or history sync is
  // replaying old messages. New messages are allowed again after a short grace.
  const key = `deleted_conversation:${character}:${targetPlayer}`;
  await db
    .insert(appSettings)
    .values({ key, value: String(Date.now()) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: String(Date.now()), updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, deleted: deleted.length });
}
