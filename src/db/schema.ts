import { index, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  character: varchar("character", { length: 128 }).notNull().default(""),
  player: varchar("player", { length: 128 }).notNull(),
  direction: varchar("direction", { length: 16 }).notNull(),
  body: text("body").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("sent"),
  externalId: varchar("external_id", { length: 128 }).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  index("messages_player_idx").on(table.player),
  index("messages_character_idx").on(table.character),
  index("messages_created_at_idx").on(table.createdAt),
  index("messages_status_idx").on(table.status),
  uniqueIndex("messages_external_id_uidx").on(table.externalId),
]);

export const clientWindows = pgTable("client_windows", {
  id: serial("id").primaryKey(),
  character: varchar("character", { length: 128 }).notNull().default(""),
  windowTitle: varchar("window_title", { length: 255 }).notNull(),
  pid: varchar("pid", { length: 32 }).notNull().default(""),
  hwnd: varchar("hwnd", { length: 32 }).notNull(),
  foreground: varchar("foreground", { length: 8 }).notNull().default("no"),
  matched: varchar("matched", { length: 8 }).notNull().default("no"),
  slot: varchar("slot", { length: 8 }).notNull().default(""),
  realm: varchar("realm", { length: 64 }).notNull().default(""),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("client_windows_character_idx").on(table.character),
  uniqueIndex("client_windows_hwnd_uidx").on(table.hwnd),
]);

export const gseState = pgTable("gse_state", {
  character: varchar("character", { length: 128 }).primaryKey(),
  running: varchar("running", { length: 8 }).notNull().default("no"),
  keybind: varchar("keybind", { length: 32 }).notNull().default("1"),
  intervalMs: varchar("interval_ms", { length: 8 }).notNull().default("100"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Message = typeof messages.$inferSelect;
export type ClientWindow = typeof clientWindows.$inferSelect;
export type GseState = typeof gseState.$inferSelect;
