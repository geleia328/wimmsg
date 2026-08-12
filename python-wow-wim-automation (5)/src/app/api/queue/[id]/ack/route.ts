import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkBridgeAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Python bridge calls POST /api/queue/{id}/ack after typing an outgoing
 * whisper into WoW (or when it fails).
 *
 * Body: { status: "sent" | "failed", error?: string }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const guard = checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const { id: idStr } = await context.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: { status?: string; error?: string } = {};
  try {
    body = (await request.json()) as { status?: string; error?: string };
  } catch {
    // empty body is fine – treat as success
  }

  const status = body.status === "failed" ? "failed" : "sent";

  const [updated] = await db
    .update(messages)
    .set({
      status,
      sentAt: new Date(),
      error: status === "failed" ? body.error ?? "unknown error" : null,
    })
    .where(eq(messages.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, message: updated });
}
