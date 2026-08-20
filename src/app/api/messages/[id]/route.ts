import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE → remove uma mensagem individual por id. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
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
