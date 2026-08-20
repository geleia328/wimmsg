import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkBridgeAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Python bridge calls this once it has typed a queued reply into the right
 * WoW window. `status` is "sent" on success or "failed" with an error reason.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let payload: { status?: string; error?: string } = {};
  try {
    payload = await request.json();
  } catch {
    // empty body is fine — defaults to "sent"
  }

  const next = payload.status === "failed" ? "failed" : "sent";
  const [updated] = await db
    .update(messages)
    .set({
      status: next,
      error: next === "failed" ? payload.error ?? "unknown error" : null,
      sentAt: new Date(),
    })
    .where(eq(messages.id, numericId))
    .returning({ id: messages.id });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: updated.id, status: next });
}
