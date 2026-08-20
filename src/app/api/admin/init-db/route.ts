import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { checkAdminAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click "create tables" used by the /settings page. Idempotent — safe to
 * run repeatedly. Mirrors the Drizzle schema in src/db/schema.ts.
 */
export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  const statements = [
    sql`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      character VARCHAR(128) NOT NULL DEFAULT '',
      player VARCHAR(128) NOT NULL,
      direction VARCHAR(16) NOT NULL,
      body TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'sent',
      external_id VARCHAR(128),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ
    )`,
    sql`CREATE INDEX IF NOT EXISTS messages_player_idx ON messages (player)`,
    sql`CREATE INDEX IF NOT EXISTS messages_character_idx ON messages (character)`,
    sql`CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at)`,
    sql`CREATE INDEX IF NOT EXISTS messages_status_idx ON messages (status)`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS messages_external_id_idx ON messages (external_id)`,

    sql`CREATE TABLE IF NOT EXISTS client_windows (
      id SERIAL PRIMARY KEY,
      character VARCHAR(128) NOT NULL DEFAULT '',
      window_title VARCHAR(255) NOT NULL,
      pid VARCHAR(32) NOT NULL DEFAULT '',
      hwnd VARCHAR(32) NOT NULL DEFAULT '',
      foreground VARCHAR(8) NOT NULL DEFAULT 'no',
      matched VARCHAR(8) NOT NULL DEFAULT 'no',
      slot VARCHAR(8) NOT NULL DEFAULT '',
      realm VARCHAR(64) NOT NULL DEFAULT '',
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS client_windows_hwnd_idx ON client_windows (hwnd)`,
    sql`CREATE INDEX IF NOT EXISTS client_windows_character_idx ON client_windows (character)`,

    sql`CREATE TABLE IF NOT EXISTS gse_state (
      character VARCHAR(128) PRIMARY KEY,
      running VARCHAR(8) NOT NULL DEFAULT 'no',
      keybind VARCHAR(32) NOT NULL DEFAULT '1',
      interval_ms VARCHAR(8) NOT NULL DEFAULT '100',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    sql`CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(128) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ];

  const errors: string[] = [];
  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { ok: false, errors, applied: statements.length - errors.length },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, applied: statements.length });
}
