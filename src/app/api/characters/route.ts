import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows, gseState, messages } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Distinct list of your characters (WoW windows) that have any activity.
 */
export async function GET() {
  const [rows, windows, gse] = await Promise.all([
    db.execute(sql/* sql */ `
      SELECT
        character,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE direction = 'incoming')::int AS incoming,
        COUNT(*) FILTER (WHERE direction = 'outgoing' AND status = 'pending')::int AS pending_out,
        MAX(created_at) AS last_at
      FROM ${messages}
      GROUP BY character
      ORDER BY last_at DESC
    `),
    db
      .select({ character: clientWindows.character })
      .from(clientWindows),
    db
      .select({ character: gseState.character })
      .from(gseState),
  ]);

  const byName = new Map<string, {
    character: string;
    total: number;
    incoming: number;
    pendingOut: number;
    lastAt: string;
  }>();

  for (const r of rows.rows) {
    const character = ((r.character as string) || "unknown").trim();
    byName.set(character.toLowerCase(), {
      character,
      total: r.total as number,
      incoming: r.incoming as number,
      pendingOut: r.pending_out as number,
      lastAt: r.last_at as string,
    });
  }

  // Include bridge-known characters even if they have zero messages yet. This
  // makes both own windows available for self-character mirroring immediately.
  for (const source of [...windows, ...gse]) {
    const character = source.character.trim();
    if (!character || byName.has(character.toLowerCase())) continue;
    byName.set(character.toLowerCase(), {
      character,
      total: 0,
      incoming: 0,
      pendingOut: 0,
      lastAt: new Date(0).toISOString(),
    });
  }

  return NextResponse.json({
    characters: Array.from(byName.values()).sort((a, b) => {
      if (a.lastAt === b.lastAt) return a.character.localeCompare(b.character);
      return a.lastAt < b.lastAt ? 1 : -1;
    }),
  });
}
