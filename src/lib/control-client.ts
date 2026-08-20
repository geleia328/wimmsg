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
