import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const since = Math.max(0, Number(new URL(request.url).searchParams.get("since") || 0));
  const rows = await db.select().from(messages).where(and(eq(messages.direction, "incoming"), gt(messages.id, since))).orderBy(desc(messages.id)).limit(50);
  rows.reverse(); return Response.json({ messages: rows, latestId: rows.reduce((max, row) => Math.max(max, row.id), since) });
}
