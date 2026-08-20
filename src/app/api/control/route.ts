import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, DEFAULT_APP_CONTROLS } from "@/db/schema";
import { checkAdminAuth, checkBridgeAuth } from "@/lib/auth";
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
  queuePollMs: number;
};

function normalize(rows: Array<{ key: string; value: string }>): Controls {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const get = (key: keyof typeof DEFAULT_APP_CONTROLS) =>
    map.get(key) ?? DEFAULT_APP_CONTROLS[key];
  const num = (v: string, min: number, max: number) =>
    Math.max(min, Math.min(max, Number.parseInt(v, 10) || min));

  // Wide ranges so the GSE page can save any timing the user types.
  // Bridge reads these values and applies them on every send.
  return {
    bridgeReaderEnabled: get("bridge_reader_enabled") === "yes",
    gseMasterEnabled: get("gse_master_enabled") === "yes",
    whisperFocusDelayMs: num(get("whisper_focus_delay_ms"), 0, 60000),
    whisperAfterSendDelayMs: num(get("whisper_after_send_delay_ms"), 0, 60000),
    whisperChatOpenDelayMs: num(get("whisper_chat_open_delay_ms"), 0, 60000),
    whisperKeystrokeDelayMs: num(get("whisper_keystroke_delay_ms"), 0, 5000),
    whisperChatSendDelayMs: num(get("whisper_chat_send_delay_ms"), 0, 60000),
    whisperCloseChatEnabled: get("whisper_close_chat_enabled") === "yes",
    whisperChatCloseDelayMs: num(get("whisper_chat_close_delay_ms"), 0, 60000),
    voiceRelayEnabled: get("voice_relay_enabled") === "yes",
    combatRelayEnabled: get("combat_relay_enabled") === "yes",
    ocrRelayEnabled: get("ocr_relay_enabled") === "yes",
    wimScreenOcrEnabled: get("wim_screen_ocr_enabled") === "yes",
    queuePollMs: num(get("queue_poll_ms"), 250, 60000),
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
    // Tables may not exist yet; return defaults.
    return normalize([]);
  }
}

export async function GET(request: NextRequest) {
  // Bridge may call this with bearer token; site can call without auth for UI.
  const auth = request.headers.get("authorization");
  if (auth) {
    const guard = await checkBridgeAuth(request);
    if (!guard.ok) return guard.response;
  }
  return NextResponse.json({ ok: true, controls: await readControls() });
}

export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  let payload: Partial<Controls> = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pairs: Array<{ key: keyof typeof DEFAULT_APP_CONTROLS; value: string }> = [];
  if (typeof payload.bridgeReaderEnabled === "boolean") {
    pairs.push({
      key: "bridge_reader_enabled",
      value: payload.bridgeReaderEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.gseMasterEnabled === "boolean") {
    pairs.push({
      key: "gse_master_enabled",
      value: payload.gseMasterEnabled ? "yes" : "no",
    });
  }
  const clampMs = (value: number, min: number, max: number) =>
    String(Math.max(min, Math.min(max, Math.floor(value))));

  if (typeof payload.whisperFocusDelayMs === "number") {
    pairs.push({
      key: "whisper_focus_delay_ms",
      value: clampMs(payload.whisperFocusDelayMs, 0, 60000),
    });
  }
  if (typeof payload.whisperAfterSendDelayMs === "number") {
    pairs.push({
      key: "whisper_after_send_delay_ms",
      value: clampMs(payload.whisperAfterSendDelayMs, 0, 60000),
    });
  }
  if (typeof payload.whisperChatOpenDelayMs === "number") {
    pairs.push({
      key: "whisper_chat_open_delay_ms",
      value: clampMs(payload.whisperChatOpenDelayMs, 0, 60000),
    });
  }
  if (typeof payload.whisperKeystrokeDelayMs === "number") {
    pairs.push({
      key: "whisper_keystroke_delay_ms",
      value: clampMs(payload.whisperKeystrokeDelayMs, 0, 5000),
    });
  }
  if (typeof payload.whisperChatSendDelayMs === "number") {
    pairs.push({
      key: "whisper_chat_send_delay_ms",
      value: clampMs(payload.whisperChatSendDelayMs, 0, 60000),
    });
  }
  if (typeof payload.whisperCloseChatEnabled === "boolean") {
    pairs.push({
      key: "whisper_close_chat_enabled",
      value: payload.whisperCloseChatEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.whisperChatCloseDelayMs === "number") {
    pairs.push({
      key: "whisper_chat_close_delay_ms",
      value: clampMs(payload.whisperChatCloseDelayMs, 0, 60000),
    });
  }
  if (typeof payload.voiceRelayEnabled === "boolean") {
    pairs.push({
      key: "voice_relay_enabled",
      value: payload.voiceRelayEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.combatRelayEnabled === "boolean") {
    pairs.push({
      key: "combat_relay_enabled",
      value: payload.combatRelayEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.ocrRelayEnabled === "boolean") {
    pairs.push({
      key: "ocr_relay_enabled",
      value: payload.ocrRelayEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.wimScreenOcrEnabled === "boolean") {
    pairs.push({
      key: "wim_screen_ocr_enabled",
      value: payload.wimScreenOcrEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.queuePollMs === "number") {
    pairs.push({
      key: "queue_poll_ms",
      value: clampMs(payload.queuePollMs, 250, 60000),
    });
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
