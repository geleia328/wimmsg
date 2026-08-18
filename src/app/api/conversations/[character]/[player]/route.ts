import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, asc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ character: string; player: string }> };

export async function GET(req: Request, { params }: Params) {
  const { character, player } = await params;
  const c = decodeURIComponent(character);
  const p = decodeURIComponent(player);
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200));
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        sql`lower(${messages.character}) = lower(${c})`,
        sql`lower(${messages.player}) = lower(${p})`,
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(limit);
  return Response.json({ ok: true, messages: rows });
}

export async function POST(req: Request, { params }: Params) {
  const { character, player } = await params;
  const c = decodeURIComponent(character);
  const p = decodeURIComponent(player);
  let body: { body?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const text = String(body.body || "").trim();
  if (!text) return Response.json({ ok: false, error: "empty body" }, { status: 400 });
  const [inserted] = await db
    .insert(messages)
    .values({
      character: c,
      player: p,
      direction: "outgoing",
      body: text,
      status: "pending",
    })
    .returning();
  return Response.json({ ok: true, message: inserted });
}

export async function DELETE(req: Request, { params }: Params) {
  const { character, player } = await params;
  const c = decodeURIComponent(character);
  const p = decodeURIComponent(player);
  await db.execute(sql`
    delete from messages
    where lower(character) = lower(${c})
      and lower(player) = lower(${p})
  `);
  return Response.json({ ok: true });
}
