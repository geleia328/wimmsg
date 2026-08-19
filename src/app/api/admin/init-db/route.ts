import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { checkAdminAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click database bootstrap for non-technical setup.
 *
 * This endpoint creates the same tables/indexes declared in Drizzle schema.
 * It is intentionally guarded by admin token because it modifies database
 * structure.
 */
export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id serial PRIMARY KEY,
        character varchar(128) NOT NULL DEFAULT '',
        player varchar(128) NOT NULL,
        direction varchar(16) NOT NULL,
        body text NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'sent',
        external_id varchar(128),
        error text,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        sent_at timestamp with time zone
      )
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS messages_external_id_idx
      ON messages (external_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_player_idx ON messages (player)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_character_idx ON messages (character)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_status_idx ON messages (status)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS client_windows (
        id serial PRIMARY KEY,
        character varchar(128) NOT NULL DEFAULT '',
        window_title varchar(255) NOT NULL,
        pid varchar(32) NOT NULL DEFAULT '',
        hwnd varchar(32) NOT NULL DEFAULT '',
        foreground varchar(8) NOT NULL DEFAULT 'no',
        matched varchar(8) NOT NULL DEFAULT 'no',
        slot varchar(8) NOT NULL DEFAULT '',
        realm varchar(64) NOT NULL DEFAULT '',
        last_seen timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS client_windows_hwnd_idx
      ON client_windows (hwnd)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS client_windows_character_idx
      ON client_windows (character)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gse_state (
        character varchar(128) PRIMARY KEY,
        running varchar(8) NOT NULL DEFAULT 'no',
        keybind varchar(32) NOT NULL DEFAULT '1',
        interval_ms varchar(8) NOT NULL DEFAULT '100',
        updated_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key varchar(128) PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      INSERT INTO app_settings (key, value) VALUES
        ('bridge_reader_enabled', 'yes'),
        ('gse_master_enabled', 'no'),
        ('whisper_focus_delay_ms', '500'),
        ('whisper_after_send_delay_ms', '500'),
        ('queue_poll_ms', '1500')
      ON CONFLICT (key) DO NOTHING
    `);

    return NextResponse.json({ ok: true, message: "tables_created_or_ready" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
