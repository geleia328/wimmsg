import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Usado pelo painel para disparar notificações sonoras de novos sussurros. */
export async function GET(request: NextRequest) {
  const since = Number.parseInt(
    request.nextUrl.searchParams.get("since") ?? "0",
    10,
  );
  const conditions = [eq(messages.direction, "incoming")];
  if (Number.isFinite(since) && since > 0) {
    conditions.push(gt(messages.id, since));
  }
  const rows = await db
    .select({
      id: messages.id,
      character: messages.character,
      player: messages.player,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.id))
    .limit(50);

  return NextResponse.json({
    messages: rows.slice().reverse(),
    latestId: rows.length > 0 ? Math.max(...rows.map((r) => r.id)) : since,
  });
}
