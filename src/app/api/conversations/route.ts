import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.execute(sql/* sql */ `
    WITH normalized AS (
      SELECT
        lower(character) AS n_character,
        lower(player) AS n_player,
        character,
        player,
        direction,
        body,
        created_at
      FROM ${messages}
      WHERE
        player IS NOT NULL
        AND length(trim(player)) >= 3
        AND lower(player) NOT IN ('unknown','guild','party','raid','system','wim','general','comercio','trade')
        AND player !~ '^\d+$'
        AND body !~* '(no do canal|intervalo|flood\s*&\s*queue|status:\s*desligado|criar link|exportar perfil|importar perfil|ligar sistema|todos os objetivos|missões|recompensas|comércio\s*-\s*cidade|guilda ativa|recruta dps|lf craft)'
    )
    SELECT
      n_character AS character,
      n_player AS player,
      MAX(created_at) AS last_at,
      (
        SELECT body FROM normalized m2
        WHERE m2.n_player = m.n_player AND m2.n_character = m.n_character
        ORDER BY created_at DESC LIMIT 1
      ) AS last_body,
      (
        SELECT direction FROM normalized m3
        WHERE m3.n_player = m.n_player AND m3.n_character = m.n_character
        ORDER BY created_at DESC LIMIT 1
      ) AS last_direction,
      COUNT(*) FILTER (WHERE direction = 'incoming')::int AS incoming_count,
      COUNT(*)::int AS total_count
    FROM normalized m
    GROUP BY n_character, n_player
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
