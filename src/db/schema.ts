import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    character: varchar("character", { length: 128 }).notNull().default(""),
    player: varchar("player", { length: 128 }).notNull(),
    direction: varchar("direction", { length: 16 }).notNull(),
    body: text("body").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("sent"),
    externalId: varchar("external_id", { length: 128 }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => ({
    playerIdx: index("messages_player_idx").on(table.player),
    characterIdx: index("messages_character_idx").on(table.character),
    createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
    statusIdx: index("messages_status_idx").on(table.status),
    externalIdIdx: uniqueIndex("messages_external_id_idx").on(table.externalId),
  }),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export const clientWindows = pgTable(
  "client_windows",
  {
    id: serial("id").primaryKey(),
    character: varchar("character", { length: 128 }).notNull().default(""),
    windowTitle: varchar("window_title", { length: 255 }).notNull(),
    pid: varchar("pid", { length: 32 }).notNull().default(""),
    hwnd: varchar("hwnd", { length: 32 }).notNull().default(""),
    foreground: varchar("foreground", { length: 8 }).notNull().default("no"),
    matched: varchar("matched", { length: 8 }).notNull().default("no"),
    slot: varchar("slot", { length: 8 }).notNull().default(""),
    realm: varchar("realm", { length: 64 }).notNull().default(""),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    windowUnique: uniqueIndex("client_windows_hwnd_idx").on(table.hwnd),
    characterIdx: index("client_windows_character_idx").on(table.character),
  }),
);

export type ClientWindow = typeof clientWindows.$inferSelect;
export type NewClientWindow = typeof clientWindows.$inferInsert;

export const gseState = pgTable("gse_state", {
  character: varchar("character", { length: 128 }).primaryKey(),
  running: varchar("running", { length: 8 }).notNull().default("no"),
  keybind: varchar("keybind", { length: 32 }).notNull().default("1"),
  intervalMs: varchar("interval_ms", { length: 8 }).notNull().default("100"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GseState = typeof gseState.$inferSelect;
export type NewGseState = typeof gseState.$inferInsert;

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export const DEFAULT_APP_CONTROLS = {
  bridge_reader_enabled: "yes",
  gse_master_enabled: "no",
  whisper_focus_delay_ms: "2000",
  whisper_after_send_delay_ms: "1000",
  whisper_chat_open_delay_ms: "1000",
  whisper_keystroke_delay_ms: "100",
  whisper_chat_send_delay_ms: "1000",
  whisper_close_chat_enabled: "yes",
  whisper_chat_close_delay_ms: "500",
  voice_relay_enabled: "no",
  combat_relay_enabled: "no",
  ocr_relay_enabled: "yes",
  wim_screen_ocr_enabled: "no",
  ocr_strip_top_px: "28",
  ocr_strip_height_px: "140",
  queue_poll_ms: "1500",
} as const;

export const DEFAULT_ADMIN_SETTINGS = {
  bridge_token: "",
  pending_timeout_minutes: "0",
} as const;
