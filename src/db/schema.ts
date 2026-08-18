import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A single whisper / chat message exchanged with a WoW character.
 *
 * `character` = which of YOUR WoW windows (logged-in character) this
 *               message belongs to. In a multi-window setup you may have
 *               20+ clients; every message is scoped to exactly one.
 *
 * `player`    = the OTHER end of the conversation (the person you whisper
 *               with).
 *
 * `direction`
 *   'incoming' → whisper received in the game (posted by Python bridge).
 *   'outgoing' → reply you typed on the website, queued for the Python
 *                bridge to type into the correct WoW window.
 *
 * `status` (outgoing only):
 *   pending → waiting for the Python bridge to pick it up
 *   sent    → Python confirmed it typed it into WoW
 *   failed  → Python reported an error (window not found, focus issue, ...)
 *
 * `externalId` is a client-side id used for idempotent ingestion so the
 * Python bridge can safely re-post the same whisper without duplicating rows.
 */
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

/**
 * Live inventory of the WoW client windows currently open on the user's PC.
 *
 * The Python bridge scans open windows (EnumWindows) every few seconds and
 * upserts a row per detected window. The web UI treats a row as "online" if
 * `last_seen` is fresh (e.g. within 15 seconds).
 *
 * `character` is the personagem identifier when we can match the window's
 * title against one of the configured [character:...] blocks. When we detect
 * a WoW-looking window that isn't configured yet, `character` is empty and
 * `matched = false` so the UI can highlight it as unmapped.
 */
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

/**
 * GSE (Gnome Sequencer Enhanced) macro spam state per character.
 *
 * The site is the source of truth for what SHOULD be running. The Python
 * bridge polls this table and starts/stops per-character spammer threads
 * to match `running`.
 *
 * `keybind`     — key that GSE is bound to inside WoW (default "1"). The
 *                 Python bridge sends PostMessage WM_KEYDOWN/WM_KEYUP for
 *                 this key, so no window focus is needed.
 * `intervalMs`  — delay between key presses. 100ms = 10 taps/second.
 */
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

/**
 * Generic app settings edited from the admin settings page.
 *
 * Important: DATABASE_URL is intentionally NOT stored here. The app needs the
 * database connection before it can read any table, so database credentials
 * must remain as an environment variable in Vercel/hosting provider.
 */
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
  whisper_focus_delay_ms: "500",
  whisper_after_send_delay_ms: "500",
  queue_poll_ms: "1500",
} as const;
