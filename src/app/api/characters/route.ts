import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Distinct list of your characters (WoW windows) that have any activity.
 */
export async function GET() {
  const rows = await db.execute(sql/* sql */ `
    SELECT
      character,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE direction = 'incoming')::int AS incoming,
      COUNT(*) FILTER (WHERE direction = 'outgoing' AND status = 'pending')::int AS pending_out,
      MAX(created_at) AS last_at
    FROM ${messages}
    GROUP BY character
    ORDER BY last_at DESC
  `);
  return NextResponse.json({
    characters: rows.rows.map((r) => ({
      character: (r.character as string) || "unknown",
      total: r.total as number,
      incoming: r.incoming as number,
      pendingOut: r.pending_out as number,
      lastAt: r.last_at as string,
    })),
  });
}
