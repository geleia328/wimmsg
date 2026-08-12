import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { checkBridgeAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Python bridge polls this endpoint to get outgoing whispers waiting to be
 * typed into WoW. Each row includes the `character` (window) it must be
 * routed to.
 */
export async function GET(request: NextRequest) {
  const guard = checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const pending = await db
    .select({
      id: messages.id,
      character: messages.character,
      player: messages.player,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.direction, "outgoing"), eq(messages.status, "pending")))
    .orderBy(asc(messages.createdAt))
    .limit(50);

  return NextResponse.json({ messages: pending });
}
