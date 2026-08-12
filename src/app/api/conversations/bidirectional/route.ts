import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { or, and, eq, asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/conversations/bidirectional?charA=Madelina-Gallywix&charB=Taldoglaidon-Gallywix
 * 
 * Retorna TODAS as mensagens entre dois personagens, independente de quem enviou.
 * Isso cria uma visão unificada da conversa em tempo real.
 */
export async function GET(request: NextRequest) {
  const charA = request.nextUrl.searchParams.get("charA");
  const charB = request.nextUrl.searchParams.get("charB");
  
  if (!charA || !charB) {
    return NextResponse.json({ error: "charA and charB required" }, { status: 400 });
  }

  // Busca mensagens em AMBAS as direções:
  // 1. charA enviou para charB
  // 2. charB enviou para charA
  const rows = await db
    .select()
    .from(messages)
    .where(
      or(
        and(
          eq(messages.character, charA),
          eq(messages.player, charB)
        ),
        and(
          eq(messages.character, charB),
          eq(messages.player, charA)
        )
      )
    )
    .orderBy(asc(messages.createdAt))
    .limit(100);

  return NextResponse.json({
    charA,
    charB,
    messages: rows,
  });
}
