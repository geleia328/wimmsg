import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await db.execute(sql`
    SELECT
      lower(character) AS character,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE direction = 'incoming')::int AS incoming,
      COUNT(*) FILTER (WHERE direction = 'outgoing' AND status = 'pending')::int AS pending_out,
      MAX(created_at) AS last_at
    FROM messages
    GROUP BY lower(character)
    ORDER BY last_at DESC
  `);

  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];

  return NextResponse.json({
    characters: rows.map((r) => ({
      character: (r.character as string) || "unknown",
      total: (r.total as number) ?? 0,
      incoming: (r.incoming as number) ?? 0,
      pendingOut: (r.pending_out as number) ?? 0,
      lastAt: r.last_at as string | null,
    })),
  });
}
