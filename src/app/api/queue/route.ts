import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, eq, asc, lt } from "drizzle-orm";
import { checkBridgeAuth } from "@/lib/auth";
import { expireStalePending } from "@/lib/queue-expire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Python bridge polls this endpoint to get outgoing whispers waiting to be
 * typed into WoW. Each row includes the `character` (window) it must be
 * routed to.
 *
 * As a side-effect we expire replies that have been pending longer than the
 * configured timeout (TODO from the handoff: "Mensagens pending ficam para
 * sempre"). With pending_timeout_minutes=0 this is a no-op.
 */
export async function GET(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  await expireStalePending();

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

/** Manual trigger (admin) to expire stale pending replies right now. */
export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const expired = await expireStalePending();
  const stale = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "outgoing"),
        eq(messages.status, "pending"),
        lt(messages.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  return NextResponse.json({ ok: true, expired, stillPending: stale.length });
}
