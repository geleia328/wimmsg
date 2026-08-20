import { db } from "@/db";
import { messages, appSettings, DEFAULT_ADMIN_SETTINGS } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";

export async function expireStalePending(): Promise<number> {
  let minutes = Number(DEFAULT_ADMIN_SETTINGS.pending_timeout_minutes);
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "pending_timeout_minutes"))
      .limit(1);
    if (row?.value) minutes = Number(row.value);
  } catch {
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
