import { db } from "@/db";
import { checkAdminAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";

export async function POST(request: Request) {
  const denied = checkAdminAuth(request); if (denied) return denied;
  const statements = [
    `create table if not exists messages (id serial primary key, character varchar(128) not null default '', player varchar(128) not null, direction varchar(16) not null, body text not null, status varchar(16) not null default 'sent', external_id varchar(128) not null unique, error text, created_at timestamptz not null default now(), sent_at timestamptz)`,
    `create table if not exists client_windows (id serial primary key, character varchar(128) not null default '', window_title varchar(255) not null, pid varchar(32) not null default '', hwnd varchar(32) not null unique, foreground varchar(8) not null default 'no', matched varchar(8) not null default 'no', slot varchar(8) not null default '', realm varchar(64) not null default '', last_seen timestamptz not null default now())`,
    `create table if not exists gse_state (character varchar(128) primary key, running varchar(8) not null default 'no', keybind varchar(32) not null default '1', interval_ms varchar(8) not null default '100', updated_at timestamptz not null default now())`,
    `create table if not exists app_settings (key varchar(128) primary key, value text not null, updated_at timestamptz not null default now())`,
    `create index if not exists messages_player_idx on messages(player)`, `create index if not exists messages_character_idx on messages(character)`, `create index if not exists messages_created_at_idx on messages(created_at)`, `create index if not exists messages_status_idx on messages(status)`, `create index if not exists client_windows_character_idx on client_windows(character)`,
    `insert into app_settings(key,value) values ('bridge_reader_enabled','yes'),('gse_master_enabled','no'),('whisper_focus_delay_ms','2000'),('whisper_after_send_delay_ms','1000'),('whisper_chat_open_delay_ms','1000'),('whisper_keystroke_delay_ms','100'),('whisper_chat_send_delay_ms','1000'),('whisper_close_chat_enabled','yes'),('whisper_chat_close_delay_ms','500'),('voice_relay_enabled','no'),('combat_relay_enabled','no'),('ocr_relay_enabled','no'),('wim_screen_ocr_enabled','no'),('queue_poll_ms','1500') on conflict(key) do nothing`,
  ];
  for (const statement of statements) await db.execute(sql.raw(statement));
  return Response.json({ ok:true, statements:statements.length });
}
