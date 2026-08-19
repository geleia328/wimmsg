import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const allRows = await db.select().from(messages);
  const [countRow] = await db.select({ c: sql<number>`count(*)::int` }).from(messages);
  return NextResponse.json({
    ok: true,
    count: countRow?.c ?? 0,
    rows: allRows.map((r) => ({
      id: r.id,
      character: r.character,
      player: r.player,
      direction: r.direction,
      body: r.body,
      externalId: r.externalId,
    })),
  });
}
