import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sinceMs = parseInt(url.searchParams.get("sinceMs") || "0", 10) || 0;
  const since = sinceMs > 0 ? new Date(sinceMs) : new Date(Date.now() - 60_000);
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.direction, "incoming"), gt(messages.createdAt, since)))
    .orderBy(desc(messages.createdAt))
    .limit(100);
  return Response.json({ ok: true, messages: rows });
}
