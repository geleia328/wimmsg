import { db } from "@/db";
import { messages, appSettings, DEFAULT_ADMIN_SETTINGS } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";

/**
 * Expires outgoing replies that have been stuck in `pending` longer than the
 * configured timeout, marking them as `failed` with a clear reason.
 *
 * This addresses the handoff TODO: "Mensagens pending ficam para sempre — se
 * personagem nunca abre, deveria ter timeout".
 *
 * The timeout is configured in app_settings under
 * `pending_timeout_minutes`. A value of 0 (the default) disables expiration.
 *
 * Returns the number of rows expired.
 */
export async function expireStalePending(): Promise<number> {
  let minutes = Number(
    DEFAULT_ADMIN_SETTINGS.pending_timeout_minutes,
  );
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "pending_timeout_minutes"))
      .limit(1);
    if (row?.value) minutes = Number(row.value);
  } catch {
    // DB unavailable — nothing to expire.
    return 0;
  }

  if (!Number.isFinite(minutes) || minutes <= 0) return 0;

  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const expired = await db
    .update(messages)
    .set({
      status: "failed",
      error: `Timed out after ${minutes} min waiting for the WoW window to open.`,
      sentAt: new Date(),
    })
    .where(
      and(
        eq(messages.direction, "outgoing"),
        eq(messages.status, "pending"),
        lt(messages.createdAt, cutoff),
      ),
    )
    .returning({ id: messages.id });

  return expired.length;
}
