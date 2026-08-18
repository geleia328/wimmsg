import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  character: string;
  player: string;
  direction: string;
  body: string;
  status: string;
  created_at: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const charA = (url.searchParams.get("charA") || "").trim();
  const charB = (url.searchParams.get("charB") || "").trim();
  if (!charA || !charB) {
    return Response.json({ ok: false, error: "charA and charB required" }, { status: 400 });
  }
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") || "300", 10) || 300));

  const res = await db.execute<Row>(sql`
    select id, character, player, direction, body, status, created_at
    from messages
    where (lower(character) = lower(${charA}) and lower(player) = lower(${charB}))
       or (lower(character) = lower(${charB}) and lower(player) = lower(${charA}))
    order by created_at asc
    limit ${limit}
  `);

  const rows = (res.rows || []) as Row[];

  // Normalize direction to perspective of charA
  type Norm = {
    id: number;
    body: string;
    status: string;
    createdAt: string;
    direction: "incoming" | "outgoing";
    key: string;
  };
  const A = charA.toLowerCase();
  const normed: Norm[] = rows.map((r) => {
    const ch = r.character.toLowerCase();
    const dirFromA = ch === A ? r.direction : r.direction === "incoming" ? "outgoing" : "incoming";
    return {
      id: r.id,
      body: r.body,
      status: r.status,
      createdAt: r.created_at,
      direction: (dirFromA === "outgoing" ? "outgoing" : "incoming") as "incoming" | "outgoing",
      key: `${dirFromA}::${r.body.trim()}`,
    };
  });

  // Deduplicate mirrored messages within 15s window
  const out: Norm[] = [];
  for (const m of normed) {
    let dup = false;
    const t = new Date(m.createdAt).getTime();
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      const dt = t - new Date(o.createdAt).getTime();
      if (dt > 15000) break;
      if (o.key === m.key) { dup = true; break; }
    }
    if (!dup) out.push(m);
  }

  return Response.json({
    ok: true,
    messages: out.map((m) => ({
      id: m.id,
      body: m.body,
      status: m.status,
      createdAt: m.createdAt,
      direction: m.direction,
    })),
  });
}
