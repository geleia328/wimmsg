import { db } from "@/db";
import { appSettings, messages } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";

/**
 * Marks outgoing messages that stayed `pending` for too long as `failed`
 * so the UI never shows a reply stuck in limbo forever.
 * `pending_timeout_minutes = 0` disables the expiration entirely.
 */
export async function expireStalePending(): Promise<number> {
  let minutes = 0;
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "pending_timeout_minutes"))
      .limit(1);
    minutes = Number.parseInt(row?.value ?? "0", 10) || 0;
  } catch {
    return 0;
  }

  if (minutes <= 0) return 0;

  const cutoff = new Date(Date.now() - minutes * 60_000);
  const updated = await db
    .update(messages)
    .set({ status: "failed", error: "timeout: bridge não confirmou o envio" })
    .where(
      and(
        eq(messages.direction, "outgoing"),
        eq(messages.status, "pending"),
        lt(messages.createdAt, cutoff),
      ),
    )
    .returning({ id: messages.id });

  return updated.length;
}
