import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkBridgeAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let payload: { status?: string; error?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const newStatus = payload.status === "failed" ? "failed" : "sent";
  const set: Record<string, unknown> = {
    status: newStatus,
    sentAt: new Date(),
  };
  if (payload.error) {
    set.error = payload.error;
  }

  const [updated] = await db
    .update(messages)
    .set(set)
    .where(eq(messages.id, id))
    .returning({ id: messages.id });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: updated.id, status: newStatus });
}
