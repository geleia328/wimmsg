import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, asc, eq, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retorna os dois lados da conversa (A→B e B→A) normalizados.
 * Necessário porque o mesmo jogador pode sussurrar para duas das suas
 * janelas ao mesmo tempo — a conversa é a união dos dois sentidos.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const charA = (sp.get("charA") ?? "").trim().toLowerCase();
  const charB = (sp.get("charB") ?? "").trim().toLowerCase();

  if (!charA || !charB) {
    return NextResponse.json(
      { error: "charA and charB required" },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        or(
          and(
            sql`lower(${messages.character}) = ${charA}`,
            sql`lower(${messages.player}) = ${charB}`,
          ),
          and(
            sql`lower(${messages.character}) = ${charB}`,
            sql`lower(${messages.player}) = ${charA}`,
          ),
        ),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(500);

  return NextResponse.json({ charA, charB, messages: rows });
}
