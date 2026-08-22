import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, DEFAULT_APP_CONTROLS } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTROL_KEYS = Object.keys(DEFAULT_APP_CONTROLS) as Array<
  keyof typeof DEFAULT_APP_CONTROLS
>;

type Controls = {
  bridgeReaderEnabled: boolean;
  gseMasterEnabled: boolean;
  whisperFocusDelayMs: number;
  whisperAfterSendDelayMs: number;
  whisperChatOpenDelayMs: number;
  whisperKeystrokeDelayMs: number;
  whisperChatSendDelayMs: number;
  whisperCloseChatEnabled: boolean;
  whisperChatCloseDelayMs: number;
  voiceRelayEnabled: boolean;
  combatRelayEnabled: boolean;
  ocrRelayEnabled: boolean;
  wimScreenOcrEnabled: boolean;
  ocrStripTopPx: number;
  ocrStripHeightPx: number;
  queuePollMs: number;
};

function normalize(rows: Array<{ key: string; value: string }>): Controls {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const get = (key: keyof typeof DEFAULT_APP_CONTROLS) =>
    map.get(key) ?? DEFAULT_APP_CONTROLS[key];
  const num = (v: string, min: number, max: number) =>
    Math.max(min, Math.min(max, Number.parseInt(v, 10) || min));

  return {
    bridgeReaderEnabled: get("bridge_reader_enabled") === "yes",
    gseMasterEnabled: get("gse_master_enabled") === "yes",
    whisperFocusDelayMs: num(get("whisper_focus_delay_ms"), 100, 5000),
    whisperAfterSendDelayMs: num(get("whisper_after_send_delay_ms"), 100, 5000),
    whisperChatOpenDelayMs: num(get("whisper_chat_open_delay_ms"), 0, 3000),
    whisperKeystrokeDelayMs: num(get("whisper_keystroke_delay_ms"), 10, 500),
    whisperChatSendDelayMs: num(get("whisper_chat_send_delay_ms"), 0, 3000),
    whisperCloseChatEnabled: get("whisper_close_chat_enabled") === "yes",
    whisperChatCloseDelayMs: num(get("whisper_chat_close_delay_ms"), 0, 3000),
    voiceRelayEnabled: get("voice_relay_enabled") === "yes",
    combatRelayEnabled: get("combat_relay_enabled") === "yes",
    ocrRelayEnabled: get("ocr_relay_enabled") === "yes",
    wimScreenOcrEnabled: get("wim_screen_ocr_enabled") === "yes",
    ocrStripTopPx: num(get("ocr_strip_top_px"), 0, 200),
    ocrStripHeightPx: num(get("ocr_strip_height_px"), 60, 260),
    queuePollMs: num(get("queue_poll_ms"), 500, 10000),
  };
}

async function readControls() {
  try {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, CONTROL_KEYS));
    return normalize(rows);
  } catch {
    return normalize([]);
  }
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth) {
    const guard = await checkBridgeAuth(request);
    if (!guard.ok) return guard.response;
  }
  return NextResponse.json({ ok: true, controls: await readControls() });
}

export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;
  let payload: Partial<Controls> = {};
  try {
    payload = (await request.json()) as Partial<Controls>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pairs: Array<{ key: string; value: string }> = [];

  const boolPairs: Array<[boolean | undefined, string]> = [
    [payload.bridgeReaderEnabled, "bridge_reader_enabled"],
    [payload.gseMasterEnabled, "gse_master_enabled"],
    [payload.whisperCloseChatEnabled, "whisper_close_chat_enabled"],
    [payload.voiceRelayEnabled, "voice_relay_enabled"],
    [payload.combatRelayEnabled, "combat_relay_enabled"],
    [payload.ocrRelayEnabled, "ocr_relay_enabled"],
    [payload.wimScreenOcrEnabled, "wim_screen_ocr_enabled"],
  ];
  for (const [val, key] of boolPairs) {
    if (typeof val === "boolean") pairs.push({ key, value: val ? "yes" : "no" });
  }

  const numPairs: Array<[number | undefined, string, number, number]> = [
    [payload.whisperFocusDelayMs, "whisper_focus_delay_ms", 100, 5000],
    [payload.whisperAfterSendDelayMs, "whisper_after_send_delay_ms", 100, 5000],
    [payload.whisperChatOpenDelayMs, "whisper_chat_open_delay_ms", 0, 3000],
    [payload.whisperKeystrokeDelayMs, "whisper_keystroke_delay_ms", 10, 500],
    [payload.whisperChatSendDelayMs, "whisper_chat_send_delay_ms", 0, 3000],
    [payload.whisperChatCloseDelayMs, "whisper_chat_close_delay_ms", 0, 3000],
    [payload.ocrStripTopPx, "ocr_strip_top_px", 0, 200],
    [payload.ocrStripHeightPx, "ocr_strip_height_px", 60, 260],
    [payload.queuePollMs, "queue_poll_ms", 500, 10000],
  ];
  for (const [val, key, min, max] of numPairs) {
    if (typeof val === "number") {
      pairs.push({
        key,
        value: String(Math.max(min, Math.min(max, Math.floor(val)))),
      });
    }
  }

  for (const p of pairs) {
    await db
      .insert(appSettings)
      .values({ key: p.key, value: p.value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: p.value, updatedAt: new Date() },
      });
  }

  return NextResponse.json({ ok: true, controls: await readControls() });
}
