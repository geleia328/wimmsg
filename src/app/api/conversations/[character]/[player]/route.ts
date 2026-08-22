import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, asc, gt, sql } from "drizzle-orm";
import { canonicalName } from "@/lib/realm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  → mensagens entre `character` (sua janela) e `player` (o outro lado).
 * POST → enfileira um novo sussurro de saída para ser digitado nessa janela.
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
    sql`lower(${messages.player}) = ${player.toLowerCase()}`,
    sql`lower(${messages.character}) = ${character.toLowerCase()}`,
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
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  if (body.length > 255) {
    return NextResponse.json(
      { error: "mensagem muito longa (máx. 255 caracteres)" },
      { status: 400 },
    );
  }

  // Validação estrita: o painel recusa nomes com dígito ou ruído
  // (corrige o caso "bleedingh0110w" / "Illidan" vs "illidan").
  const canonicalCharacter = canonicalName(character);
  const canonicalPlayer = canonicalName(player);
  if (!canonicalCharacter) {
    return NextResponse.json(
      { error: `personagem inválido: "${character}"` },
      { status: 400 },
    );
  }
  if (!canonicalPlayer) {
    return NextResponse.json(
      {
        error:
          `destinatário inválido: "${player}". O nome precisa ser ` +
          `"Personagem-Realm" com apenas letras (ex: fataburns-illidan). ` +
          `Sem dígitos — OCR não pode transformar 'o' em '0' ou 'l' em '1'.`,
      },
      { status: 400 },
    );
  }

  const charRealm = canonicalCharacter.includes("-")
    ? canonicalCharacter.split("-").slice(-1)[0]
    : "";
  const playerRealm = canonicalPlayer.includes("-")
    ? canonicalPlayer.split("-").slice(-1)[0]
    : "";
  const realmWarning =
    charRealm && playerRealm && charRealm !== playerRealm
      ? `Personagem está em ${canonicalCharacter.split("-").slice(-1)[0]} mas o destinatário está em ${canonicalPlayer.split("-").slice(-1)[0]}. O envio pode falhar se os servidores não estiverem conectados.`
      : undefined;

  const [inserted] = await db
    .insert(messages)
    .values({
      character: canonicalCharacter,
      player: canonicalPlayer,
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
      and(
        sql`lower(${messages.character}) = ${character.toLowerCase()}`,
        sql`lower(${messages.player}) = ${player.toLowerCase()}`,
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
