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
  if (typeof payload.whisperFocusDelayMs === "number") {
    pairs.push({
      key: "whisper_focus_delay_ms",
      value: String(Math.max(100, Math.min(5000, Math.floor(payload.whisperFocusDelayMs)))),
    });
  }
  if (typeof payload.whisperAfterSendDelayMs === "number") {
    pairs.push({
      key: "whisper_after_send_delay_ms",
      value: String(Math.max(100, Math.min(5000, Math.floor(payload.whisperAfterSendDelayMs)))),
    });
  }
  if (typeof payload.whisperChatOpenDelayMs === "number") {
    pairs.push({
      key: "whisper_chat_open_delay_ms",
      value: String(Math.max(0, Math.min(3000, Math.floor(payload.whisperChatOpenDelayMs)))),
    });
  }
  if (typeof payload.whisperKeystrokeDelayMs === "number") {
    pairs.push({
      key: "whisper_keystroke_delay_ms",
      value: String(Math.max(10, Math.min(500, Math.floor(payload.whisperKeystrokeDelayMs)))),
    });
  }
  if (typeof payload.whisperChatSendDelayMs === "number") {
    pairs.push({
      key: "whisper_chat_send_delay_ms",
      value: String(Math.max(0, Math.min(3000, Math.floor(payload.whisperChatSendDelayMs)))),
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
      value: String(Math.max(0, Math.min(3000, Math.floor(payload.whisperChatCloseDelayMs)))),
    });
  }
  if (typeof payload.voiceRelayEnabled === "boolean") {
    pairs.push({
      key: "voice_relay_enabled",
      value: payload.voiceRelayEnabled ? "yes" : "no",
    });
  }
  if (typeof payload.queuePollMs === "number") {
    pairs.push({
      key: "queue_poll_ms",
      value: String(Math.max(500, Math.min(10000, Math.floor(payload.queuePollMs)))),
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
