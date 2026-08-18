import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth, unauthorized } from "@/lib/auth";
import { and, asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkBridgeAuth(req)) return unauthorized();
  const url = new URL(req.url);
  const character = (url.searchParams.get("character") || "").trim();
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));
  const cond = character
    ? and(eq(messages.direction, "outgoing"), eq(messages.status, "pending"))
    : and(eq(messages.direction, "outgoing"), eq(messages.status, "pending"));
  const rows = await db.select().from(messages).where(cond).orderBy(asc(messages.createdAt)).limit(limit);
  const filtered = character
    ? rows.filter((r) => r.character.trim().toLowerCase() === character.toLowerCase())
    : rows;
  return Response.json({ ok: true, queue: filtered });
}
