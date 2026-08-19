import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE → removes a single chat message by id.
 *
 * This is intentionally available to the web UI just like sending a reply is:
 * Bakers Whisper is a personal/private panel, and the user can clean the chat
 * history whenever needed. If the removed message was still `pending`, it also
 * disappears from /api/queue automatically because the queue is backed by this
 * table.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_message_id" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(messages)
    .where(eq(messages.id, id))
    .returning({ id: messages.id });

  if (!deleted) {
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deletedId: deleted.id });
}
