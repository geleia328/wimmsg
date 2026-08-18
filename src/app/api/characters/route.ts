import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await db.execute<{ character: string; last_at: string }>(sql`
    select distinct on (lower(character))
      character,
      max(created_at) over (partition by lower(character)) as last_at
    from messages
    order by lower(character), max(created_at) over (partition by lower(character)) desc
  `);
  const chars = (res.rows || []).map((r) => ({ character: r.character, lastAt: r.last_at }));

  // Include client_windows characters
  const winRes = await db.execute<{ character: string; last_seen: string }>(sql`
    select distinct on (lower(character))
      character, max(last_seen) over (partition by lower(character)) as last_seen
    from client_windows
    where character is not null and character <> ''
    order by lower(character), max(last_seen) over (partition by lower(character)) desc
  `);
  for (const w of winRes.rows || []) {
    if (!chars.find((c) => c.character.toLowerCase() === w.character.toLowerCase())) {
      chars.push({ character: w.character, lastAt: w.last_seen });
    }
  }
  chars.sort((a, b) => a.character.localeCompare(b.character));
  return Response.json({ ok: true, characters: chars });
}
