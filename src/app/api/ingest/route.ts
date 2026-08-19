import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { randomId } from "@/lib/shared";

export async function POST(request: Request) {
  const denied = await checkBridgeAuth(request); if (denied) return denied;
  const payload = await request.json().catch(() => ({})) as { messages?: Array<{ externalId?: string; character?: string; player?: string; body?: string; receivedAt?: string }> };
  const values = (payload.messages ?? []).filter((m) => m.character?.trim() && m.player?.trim() && m.body?.trim()).map((m) => ({
    externalId: (m.externalId || randomId("in")).slice(0, 128), character: m.character!.trim().slice(0, 128), player: m.player!.trim().slice(0, 128),
    body: m.body!.trim(), direction: "incoming", status: "sent", createdAt: m.receivedAt && !Number.isNaN(Date.parse(m.receivedAt)) ? new Date(m.receivedAt) : new Date(),
  }));
  if (!values.length) return Response.json({ inserted: 0 });
  const inserted = await db.insert(messages).values(values).onConflictDoNothing({ target: messages.externalId }).returning({ id: messages.id });
  return Response.json({ inserted: inserted.length });
}
