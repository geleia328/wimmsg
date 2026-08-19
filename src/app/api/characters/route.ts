import { db } from "@/db";
import { messages } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export async function GET() {
  const rows = await db.select({ character: messages.character, total: sql<number>`count(*)::int`, incoming: sql<number>`count(*) filter (where ${messages.direction} = 'incoming')::int`, pendingOut: sql<number>`count(*) filter (where ${messages.direction} = 'outgoing' and ${messages.status} = 'pending')::int`, lastAt: sql<Date>`max(${messages.createdAt})` }).from(messages).groupBy(messages.character).orderBy(desc(sql`max(${messages.createdAt})`));
  return Response.json({ characters: rows });
}
