import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export async function GET() {
  const result = await db.execute(sql`select m.character, m.player, max(m.created_at) as "lastAt", (array_agg(m.body order by m.created_at desc, m.id desc))[1] as "lastBody", (array_agg(m.direction order by m.created_at desc, m.id desc))[1] as "lastDirection", count(*) filter (where m.direction='incoming')::int as "incomingCount", count(*)::int as "totalCount", count(*) filter (where m.direction='outgoing' and m.status='pending')::int as "pendingOut" from messages m group by m.character,m.player order by max(m.created_at) desc limit 500`);
  return Response.json({ conversations: result.rows });
}
