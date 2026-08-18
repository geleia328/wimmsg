import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth, unauthorized } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!checkBridgeAuth(req)) return unauthorized();
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (!Number.isFinite(numId)) {
    return Response.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  let body: { status?: string; error?: string; externalId?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const status = body.status === "failed" ? "failed" : "sent";
  const update: Partial<typeof messages.$inferInsert> = {
    status,
    sentAt: new Date(),
  };
  if (body.error) update.error = String(body.error).slice(0, 2000);
  if (body.externalId) update.externalId = String(body.externalId);
  await db.update(messages).set(update).where(eq(messages.id, numId));
  return Response.json({ ok: true });
}
