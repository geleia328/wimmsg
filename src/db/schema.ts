import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    character: varchar("character", { length: 128 }).notNull(),
    player: varchar("player", { length: 128 }).notNull(),
    direction: varchar("direction", { length: 16 }).notNull(),
    body: text("body").notNull().default(""),
    status: varchar("status", { length: 16 }).notNull().default("received"),
    externalId: varchar("external_id", { length: 128 }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => ({
    byPlayer: index("messages_player_idx").on(t.player),
    byCharacter: index("messages_character_idx").on(t.character),
    byCreatedAt: index("messages_created_at_idx").on(t.createdAt),
    byStatus: index("messages_status_idx").on(t.status),
    externalIdUniq: uniqueIndex("messages_external_id_uniq").on(t.externalId),
  }),
);

export const clientWindows = pgTable("client_windows", {
  id: serial("id").primaryKey(),
  character: varchar("character", { length: 128 }),
  windowTitle: text("window_title"),
  pid: varchar("pid", { length: 32 }),
  hwnd: varchar("hwnd", { length: 32 }),
  foreground: varchar("foreground", { length: 8 }).default("no"),
  matched: varchar("matched", { length: 8 }).default("no"),
  slot: varchar("slot", { length: 32 }),
  realm: varchar("realm", { length: 128 }),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
});

export const gseState = pgTable("gse_state", {
  character: varchar("character", { length: 128 }).primaryKey(),
  running: varchar("running", { length: 8 }).notNull().default("no"),
  keybind: varchar("keybind", { length: 32 }).notNull().default("1"),
  intervalMs: varchar("interval_ms", { length: 16 }).notNull().default("120"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
