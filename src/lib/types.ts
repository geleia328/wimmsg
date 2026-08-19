export type Conversation = { character: string; player: string; lastAt: string; lastBody: string; lastDirection: string; incomingCount: number; totalCount: number; pendingOut: number };
export type CharacterSummary = { character: string; total: number; incoming: number; pendingOut: number; lastAt: string | null };
export type WindowStatus = { id: number; character: string; windowTitle: string; pid: string; hwnd: string; foreground: boolean; matched: boolean; slot: string; realm: string; lastSeen: string; online: boolean; secondsAgo: number };
export type ChatMessage = { id: number; character: string; player: string; direction: string; body: string; status: string; externalId: string; error: string | null; createdAt: string; sentAt: string | null };
export type GseRow = { character: string; running: boolean; keybind: string; intervalMs: number; updatedAt: string };
