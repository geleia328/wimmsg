import { db } from "@/db";
import { appSettings } from "@/db/schema";

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
