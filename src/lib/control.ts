import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const CONTROL_KEYS = {
  bridgeReaderEnabled: "bridge_reader_enabled",
  gseMasterEnabled: "gse_master_enabled",
  whisperFocusDelayMs: "whisper_focus_delay_ms",
  whisperAfterSendDelayMs: "whisper_after_send_delay_ms",
  whisperChatOpenDelayMs: "whisper_chat_open_delay_ms",
  whisperKeystrokeDelayMs: "whisper_keystroke_delay_ms",
  whisperChatSendDelayMs: "whisper_chat_send_delay_ms",
  whisperCloseChatEnabled: "whisper_close_chat_enabled",
  whisperChatCloseDelayMs: "whisper_chat_close_delay_ms",
  voiceRelayEnabled: "voice_relay_enabled",
  combatRelayEnabled: "combat_relay_enabled",
  ocrRelayEnabled: "ocr_relay_enabled",
  wimScreenOcrEnabled: "wim_screen_ocr_enabled",
  queuePollMs: "queue_poll_ms",
} as const;

export type Controls = {
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

export const DEFAULT_CONTROLS: Controls = {
  bridgeReaderEnabled: true,
  gseMasterEnabled: false,
  whisperFocusDelayMs: 2000,
  whisperAfterSendDelayMs: 1000,
  whisperChatOpenDelayMs: 1000,
  whisperKeystrokeDelayMs: 100,
  whisperChatSendDelayMs: 1000,
  whisperCloseChatEnabled: true,
  whisperChatCloseDelayMs: 500,
  voiceRelayEnabled: false,
  combatRelayEnabled: false,
  ocrRelayEnabled: false,
  wimScreenOcrEnabled: false,
  queuePollMs: 1500,
};

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};

export async function readControls(): Promise<Controls> {
  const keys = Object.values(CONTROL_KEYS);
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    bridgeReaderEnabled: (map.get(CONTROL_KEYS.bridgeReaderEnabled) ?? "yes") === "yes",
    gseMasterEnabled: (map.get(CONTROL_KEYS.gseMasterEnabled) ?? "no") === "yes",
    whisperFocusDelayMs: clamp(map.get(CONTROL_KEYS.whisperFocusDelayMs), 2000, 0, 60000),
    whisperAfterSendDelayMs: clamp(map.get(CONTROL_KEYS.whisperAfterSendDelayMs), 1000, 0, 60000),
    whisperChatOpenDelayMs: clamp(map.get(CONTROL_KEYS.whisperChatOpenDelayMs), 1000, 0, 60000),
    whisperKeystrokeDelayMs: clamp(map.get(CONTROL_KEYS.whisperKeystrokeDelayMs), 100, 0, 5000),
    whisperChatSendDelayMs: clamp(map.get(CONTROL_KEYS.whisperChatSendDelayMs), 1000, 0, 60000),
    whisperCloseChatEnabled: (map.get(CONTROL_KEYS.whisperCloseChatEnabled) ?? "yes") === "yes",
    whisperChatCloseDelayMs: clamp(map.get(CONTROL_KEYS.whisperChatCloseDelayMs), 500, 0, 60000),
    voiceRelayEnabled: (map.get(CONTROL_KEYS.voiceRelayEnabled) ?? "no") === "yes",
    combatRelayEnabled: (map.get(CONTROL_KEYS.combatRelayEnabled) ?? "no") === "yes",
    ocrRelayEnabled: (map.get(CONTROL_KEYS.ocrRelayEnabled) ?? "no") === "yes",
    wimScreenOcrEnabled: (map.get(CONTROL_KEYS.wimScreenOcrEnabled) ?? "no") === "yes",
    queuePollMs: clamp(map.get(CONTROL_KEYS.queuePollMs), 1500, 250, 60000),
  };
}
