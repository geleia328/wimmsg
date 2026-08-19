import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await checkBridgeAuth(request); if (denied) return denied;
  const { id } = await params; const numericId = Number(id);
  const body = await request.json().catch(() => ({})) as { status?: string; error?: string };
  if (!Number.isInteger(numericId) || !["sent", "failed"].includes(body.status ?? "")) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const updated = await db.update(messages).set({ status: body.status!, error: body.error?.slice(0, 2000) || null, sentAt: new Date() }).where(eq(messages.id, numericId)).returning();
  return Response.json({ message: updated[0] ?? null });
}
