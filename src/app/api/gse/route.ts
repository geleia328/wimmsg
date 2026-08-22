import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows, gseState, messages } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GseConfig = {
  character: string;
  running: boolean;
  keybind: string;
  intervalMs: number;
  lastSeenAt: string | null;
  secondsAgo: number | null;
  recentInbound: number;
};

/**
 * GET → lista o estado GSE de TODOS os personagens conhecidos.
 * A lista é a união de:
 *   1) chaves em gse_state  (configuração salva)
 *   2) personagens que já tiveram mensagens no banco
 * Assim o painel mostra tanto quem está configurado quanto quem
 * está só aparecendo nas conversas.
 *
 * Cada entrada tem:
 *   - running         se o bridge disse que está rodando (yes/no)
 *   - keybind         tecla configurada (ex: "1", "F1", "grave")
 *   - intervalMs      intervalo entre presses
 *   - lastSeenAt      quando o bridge reportou pela última vez
 *   - recentInbound   quantos whispers INCOMING nos últimos 30 min
 *                    (indica se a conta está sendo usada)
 */
export async function GET() {
  // 1) configurações salvas
  const stateRows = await db.select().from(gseState);
  const byChar = new Map<string, (typeof stateRows)[number]>();
  for (const r of stateRows) byChar.set(r.character, r);

  // O status do bridge vem do scan das janelas, não da última alteração
  // feita no formulário GSE. Assim a bolinha "conectado" representa o
  // executável realmente rodando no PC.
  const windowRows = await db.select().from(clientWindows);
  const lastBridgeSeen = new Map<string, Date>();
  for (const row of windowRows) {
    const character = row.character.trim().toLowerCase();
    if (!character) continue;
    const previous = lastBridgeSeen.get(character);
    if (!previous || row.lastSeen > previous) {
      lastBridgeSeen.set(character, row.lastSeen);
    }
  }

  // 2) personagens conhecidos pelas mensagens
  const charRows = await db.execute(sql`
    SELECT
      lower(character) AS character,
      MAX(created_at) AS last_msg,
      COUNT(*) FILTER (
        WHERE direction = 'incoming' AND created_at >= NOW() - INTERVAL '30 minutes'
      )::int AS recent_inbound
    FROM messages
    GROUP BY lower(character)
  `);
  const charRowsList = (charRows as unknown as { rows: Record<string, unknown>[] })
    .rows ?? [];
  const chars = new Set<string>();
  const recentInbound = new Map<string, number>();
  const lastMsgAt = new Map<string, string>();
  for (const r of charRowsList) {
    const c = (r.character as string) || "";
    if (!c) continue;
    chars.add(c);
    recentInbound.set(c, (r.recent_inbound as number) ?? 0);
    lastMsgAt.set(c, (r.last_msg as string) ?? "");
  }
  for (const c of byChar.keys()) chars.add(c);

  const now = Date.now();
  const items: GseConfig[] = [];
  for (const c of [...chars].sort()) {
    const s = byChar.get(c);
    const lastSeen = lastBridgeSeen.get(c)?.getTime() ?? null;
    items.push({
      character: c,
      running: s?.running === "yes",
      keybind: s?.keybind ?? "1",
      intervalMs: s ? Number.parseInt(s.intervalMs, 10) || 100 : 100,
      lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
      secondsAgo: lastSeen ? Math.max(0, Math.round((now - lastSeen) / 1000)) : null,
      recentInbound: recentInbound.get(c) ?? 0,
    });
  }

  const normalizedItems = items.map((item) => ({
    character: item.character,
    running: item.running,
    keybind: item.keybind,
    intervalMs: item.intervalMs,
    updatedAt: item.lastSeenAt,
  }));
  return NextResponse.json({
    ok: true,
    master: byChar.size > 0
      ? (await db.select().from(gseState).limit(1))[0]?.running === "yes" && items.some((i) => i.running)
      : false,
    items,
    // Compatibilidade com o WhisperRelay anterior, que lia `states`.
    // O bridge novo usa `items` e /api/gse/poll.
    states: normalizedItems,
  });
}
