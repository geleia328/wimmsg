import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One row per (character, player) pair with a preview + counters.
 */
export async function GET() {
  const rows = await db.execute(sql/* sql */ `
    SELECT
      character,
      player,
      MAX(created_at) AS last_at,
      (
        SELECT body FROM ${messages} m2
        WHERE m2.player = m.player AND m2.character = m.character
        ORDER BY created_at DESC LIMIT 1
      ) AS last_body,
      (
        SELECT direction FROM ${messages} m3
        WHERE m3.player = m.player AND m3.character = m.character
        ORDER BY created_at DESC LIMIT 1
      ) AS last_direction,
      COUNT(*) FILTER (WHERE direction = 'incoming')::int AS incoming_count,
      COUNT(*)::int AS total_count
    FROM ${messages} m
    GROUP BY character, player
    ORDER BY last_at DESC
    LIMIT 500
  `);

  return NextResponse.json({
    conversations: rows.rows.map((r) => ({
      character: (r.character as string) || "unknown",
      player: r.player as string,
      lastAt: r.last_at as string,
      lastBody: r.last_body as string,
      lastDirection: r.last_direction as "incoming" | "outgoing",
      incomingCount: r.incoming_count as number,
      totalCount: r.total_count as number,
    })),
  });
}
