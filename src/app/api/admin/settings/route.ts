import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { checkAdminAuth, unauthorized } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DEFAULTS: Record<string, string> = {
  bridge_reader_enabled: "yes",
  gse_master_enabled: "no",
  whisper_focus_delay_ms: "2000",
  whisper_after_send_delay_ms: "1000",
  whisper_chat_open_delay_ms: "1000",
  whisper_keystroke_delay_ms: "100",
  whisper_chat_send_delay_ms: "1000",
  whisper_close_chat_enabled: "yes",
  whisper_chat_close_delay_ms: "500",
  queue_poll_ms: "1500",
};

export async function GET() {
  const rows = await db.select().from(appSettings);
  const map: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;
  return Response.json({ ok: true, settings: map });
}

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) return unauthorized();
  let payload: unknown;
  try { payload = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const entries = (payload as { settings?: Record<string, string> })?.settings || (payload as Record<string, string>);
  if (!entries || typeof entries !== "object") {
    return Response.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }
  for (const [k, v] of Object.entries(entries)) {
    const key = String(k).slice(0, 64);
    const value = String(v ?? "");
    await db.execute(sql`
      insert into app_settings (key, value, updated_at)
      values (${key}, ${value}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `);
  }
  return Response.json({ ok: true });
}
