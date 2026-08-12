import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, asc, eq, gt, sql, or } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const character = "A-TEST";
  const player = "B-TEST";

  // Simular a busca simétrica diretamente com drizzle
  const conditions = [
    or(
      and(eq(messages.character, character), eq(messages.player, player)),
      and(eq(messages.character, player), eq(messages.player, character)),
    ),
  ];

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.createdAt))
    .limit(500);

  return NextResponse.json({
    method: "simulated_bidirectional",
    searchFor: { character, player },
    count: rows.length,
    messages: rows.map((r) => ({
      id: r.id,
      character: r.character,
      player: r.player,
      direction: r.direction,
      body: r.body,
    })),
  });
}
