import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  // Group by lower(character), lower(player) to avoid case duplicates.
  const rows = await db.execute<{
    character: string;
    player: string;
    last_at: string;
    last_body: string;
    last_direction: string;
    incoming_count: string;
    total_count: string;
  }>(sql`
    with normalized as (
      select
        lower(character) as ch_key,
        lower(player)    as pl_key,
        character,
        player,
        direction,
        body,
        created_at,
        status
      from messages
    ),
    grouped as (
      select
        ch_key,
        pl_key,
        max(created_at) as last_at,
        count(*) filter (where direction = 'incoming') as incoming_count,
        count(*) as total_count
      from normalized
      group by ch_key, pl_key
    ),
    last_msg as (
      select distinct on (lower(character), lower(player))
        lower(character) as ch_key,
        lower(player)    as pl_key,
        character,
        player,
        body,
        direction,
        created_at
      from messages
      order by lower(character), lower(player), created_at desc
    )
    select
      l.character,
      l.player,
      g.last_at,
      l.body      as last_body,
      l.direction as last_direction,
      g.incoming_count,
      g.total_count
    from grouped g
    join last_msg l on l.ch_key = g.ch_key and l.pl_key = g.pl_key
    order by g.last_at desc
    limit 200
  `);
  const list = (rows.rows || []).map((r) => ({
    character: r.character,
    player: r.player,
    lastAt: r.last_at,
    lastBody: r.last_body,
    lastDirection: r.last_direction,
    incomingCount: Number(r.incoming_count) || 0,
    totalCount: Number(r.total_count) || 0,
  }));
  return Response.json({ ok: true, conversations: list });
}
