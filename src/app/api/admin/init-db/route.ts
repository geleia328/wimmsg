import { db } from "@/db";
import { checkAdminAuth, unauthorized } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) return unauthorized();
  try {
    await db.execute(sql`
      create table if not exists messages (
        id serial primary key,
        character varchar(128) not null,
        player varchar(128) not null,
        direction varchar(16) not null,
        body text not null default '',
        status varchar(16) not null default 'received',
        external_id varchar(128),
        error text,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      )
    `);
    await db.execute(sql`create index if not exists messages_player_idx on messages(player)`);
    await db.execute(sql`create index if not exists messages_character_idx on messages(character)`);
    await db.execute(sql`create index if not exists messages_created_at_idx on messages(created_at)`);
    await db.execute(sql`create index if not exists messages_status_idx on messages(status)`);
    await db.execute(sql`create unique index if not exists messages_external_id_uniq on messages(external_id)`);
    await db.execute(sql`
      create table if not exists client_windows (
        id serial primary key,
        character varchar(128),
        window_title text,
        pid varchar(32),
        hwnd varchar(32),
        foreground varchar(8) default 'no',
        matched varchar(8) default 'no',
        slot varchar(32),
        realm varchar(128),
        last_seen timestamptz not null default now()
      )
    `);
    await db.execute(sql`
      create table if not exists gse_state (
        character varchar(128) primary key,
        running varchar(8) not null default 'no',
        keybind varchar(32) not null default '1',
        interval_ms varchar(16) not null default '120',
        updated_at timestamptz not null default now()
      )
    `);
    await db.execute(sql`
      create table if not exists app_settings (
        key varchar(64) primary key,
        value text not null default '',
        updated_at timestamptz not null default now()
      )
    `);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[init-db] failed", e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
