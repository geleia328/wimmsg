import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows, messages } from "@/db/schema";
import { desc, eq, gte, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Janela é considerada "online" se QUALQUER uma das condições for
 * verdadeira:
 *   1. O bridge reportou a janela nos últimos ONLINE_BY_SCAN_MS (scan vivo)
 *   2. A janela recebeu um whisper nos últimos ONLINE_BY_ACTIVITY_MS
 *      (essa é a regra que você pediu: a conta pode estar sem reportar
 *       ao bridge mas continua "online" porque está mandando mensagem)
 *
 * Sem essa segunda regra, qualquer pausa do bridge (>45s) marcava a
 * janela como offline mesmo com o WoW aberto e recebendo whispers.
 */
const ONLINE_BY_SCAN_MS = 120_000;       // 2 min
const ONLINE_BY_ACTIVITY_MS = 300_000;   // 5 min

export async function GET() {
  const now = Date.now();
  const activityCutoff = new Date(now - ONLINE_BY_ACTIVITY_MS);

  // Último whisper recebido por personagem (só direction='incoming' conta
  // como "atividade da conta").
  const lastIncomingRows = await db
    .select({
      character: sql<string>`lower(${messages.character})`,
      lastIncomingAt: sql<Date>`max(${messages.createdAt})`,
    })
    .from(messages)
    .where(
      sql`${messages.direction} = 'incoming' AND ${messages.createdAt} >= ${activityCutoff}`,
    )
    .groupBy(sql`lower(${messages.character})`);

  const lastIncoming = new Map<string, number>();
  for (const r of lastIncomingRows) {
    if (r.character && r.lastIncomingAt) {
      lastIncoming.set(r.character, new Date(r.lastIncomingAt).getTime());
    }
  }

  const rows = await db
    .select()
    .from(clientWindows)
    .orderBy(desc(clientWindows.lastSeen))
    .limit(200);

  const windows = rows.map((w) => {
    const lastSeenAt = new Date(w.lastSeen).getTime();
    const secondsAgo = Math.max(0, Math.round((now - lastSeenAt) / 1000));
    const lastIncomingAt = lastIncoming.get(w.character) ?? 0;
    const secondsSinceIncoming = lastIncomingAt
      ? Math.max(0, Math.round((now - lastIncomingAt) / 1000))
      : Infinity;

    const onlineByScan = secondsAgo * 1000 < ONLINE_BY_SCAN_MS;
    const onlineByActivity = secondsSinceIncoming * 1000 < ONLINE_BY_ACTIVITY_MS;
    const online = onlineByScan || onlineByActivity;

    return {
      id: w.id,
      character: w.character,
      windowTitle: w.windowTitle,
      pid: w.pid,
      hwnd: w.hwnd,
      foreground: w.foreground === "yes",
      matched: w.matched === "yes",
      slot: w.slot,
      realm: w.realm,
      lastSeen: w.lastSeen.toISOString(),
      lastIncomingAt: lastIncomingAt
        ? new Date(lastIncomingAt).toISOString()
        : null,
      secondsAgo,
      secondsSinceIncoming: Number.isFinite(secondsSinceIncoming)
        ? secondsSinceIncoming
        : null,
      onlineByScan,
      onlineByActivity,
      online,
    };
  });

  return NextResponse.json({
    ok: true,
    windows,
    online: windows.filter((w) => w.online).length,
    onlineByScan: windows.filter((w) => w.onlineByScan).length,
    onlineByActivity: windows.filter((w) => w.onlineByActivity).length,
    bridgeSeenAt: rows[0]?.lastSeen?.toISOString() ?? null,
  });
}
