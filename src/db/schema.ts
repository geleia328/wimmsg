import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const characters = pgTable("characters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  description: text("description"),
  greeting: text("greeting"),
  personality: text("personality"),
  systemPrompt: text("system_prompt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id").notNull(),
  playerId: integer("player_id").notNull(),
  title: text("title").notNull(),
  bridgeToken: text("bridge_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderType: text("sender_type").notNull(), // 'character' | 'player' | 'system'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// GSE Control tables
export const gseGlobalSettings = pgTable("gse_global_settings", {
  id: serial("id").primaryKey(),
  leitorWindowsActive: boolean("leitor_windows_active").default(false).notNull(),
  masterGseActive: boolean("master_gse_active").default(true).notNull(),
  pressEscAfterSend: boolean("press_esc_after_send").default(false).notNull(),
  delayEnter: integer("delay_enter").default(500).notNull(),
  delayBeforeSpace: integer("delay_before_space").default(500).notNull(),
  delaySpaceWhisper: integer("delay_space_whisper").default(500).notNull(),
  delayFocusWindow: integer("delay_focus_window").default(500).notNull(),
  delayBetweenKeys: integer("delay_between_keys").default(500).notNull(),
  delaySendMsg: integer("delay_send_msg").default(500).notNull(),
  delayAfterWhisper: integer("delay_after_whisper").default(500).notNull(),
  delayPollQueue: integer("delay_poll_queue").default(500).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const gseCharacters = pgTable("gse_characters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slot: text("slot").default("wow0").notNull(),
  status: text("status").default("online").notNull(), // 'online' | 'offline' | 'busy'
  keyGse: text("key_gse").default("F5").notNull(),
  intervalMs: integer("interval_ms").default(2000).notNull(),
  isRodando: boolean("is_rodando").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type GseGlobalSetting = typeof gseGlobalSettings.$inferSelect;
export type NewGseGlobalSetting = typeof gseGlobalSettings.$inferInsert;

export type GseCharacter = typeof gseCharacters.$inferSelect;
export type NewGseCharacter = typeof gseCharacters.$inferInsert;
