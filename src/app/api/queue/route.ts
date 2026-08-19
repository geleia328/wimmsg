import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { and, asc, eq } from "drizzle-orm";

export async function GET(request: Request) {
  const denied = await checkBridgeAuth(request); if (denied) return denied;
  const rows = await db.select({ id: messages.id, character: messages.character, player: messages.player, body: messages.body, createdAt: messages.createdAt })
    .from(messages).where(and(eq(messages.direction, "outgoing"), eq(messages.status, "pending"))).orderBy(asc(messages.createdAt)).limit(50);
  return Response.json({ messages: rows });
}
