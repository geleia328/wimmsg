import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLikelyPlayerName(player: string): boolean {
  const p = player.trim().toLowerCase();
  if (p.length < 3 || p.length > 64) return false;
  if (!/[a-zà-ÿ]/i.test(p)) return false;
  if (/^\d+$/.test(p)) return false;
  return !["unknown", "guild", "party", "raid", "system", "wim", "general", "comercio", "trade"].includes(p);
}

function isLikelyPollutedBody(body: string): boolean {
  return /\b(no do canal|intervalo|flood\s*&\s*queue|status:\s*desligado|criar link|exportar perfil|importar perfil|ligar sistema|todos os objetivos|missões|recompensas|comércio\s*-\s*cidade|guilda ativa|recruta dps|lf craft)\b/i.test(body);
}

async function filterDeletedConversationGrace<
  T extends { character: string; player: string; createdAt: Date },
>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  try {
    const tombstones = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(sql`${appSettings.key} like 'deleted_conversation:%'`);
    if (tombstones.length === 0) return rows;
    const deleted = new Map<string, number>();
    for (const t of tombstones) {
      deleted.set(t.key.replace(/^deleted_conversation:/, ""), Number(t.value) || 0);
    }
    const GRACE_MS = 120_000;
    return rows.filter((r) => {
      const key = `${r.character.toLowerCase()}:${r.player.toLowerCase()}`;
      const deletedAt = deleted.get(key);
      if (!deletedAt) return true;
      return new Date(r.createdAt).getTime() > deletedAt + GRACE_MS;
    });
  } catch {
    return rows;
  }
}

type SyncPayload = {
  messages?: Array<{
    externalId?: string;
    character?: string;
    player?: string;
    body?: string;
    receivedAt?: string;
    direction?: "incoming" | "outgoing";
    status?: string;
  }>;
};

/**
 * Historical/live sync endpoint used by BakersWhisper.exe.
 * It accepts the same format as /api/ingest, but exists separately because
 * older bridge builds call /api/sync when reading the last lines from
 * WoWChatLog.txt at startup. Without this route, history sync silently fails.
 */
export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  let payload: SyncPayload;
  try {
    payload = (await request.json()) as SyncPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  const rows = raw
    .filter(
      (m) =>
        typeof m.character === "string" &&
        typeof m.player === "string" &&
        typeof m.body === "string" &&
        m.player.trim() &&
        m.body.trim(),
    )
    .map((m) => {
      const direction = m.direction === "outgoing" ? ("outgoing" as const) : ("incoming" as const);
      const character = (m.character ?? "unknown").trim().toLowerCase() || "unknown";
      const player = (m.player ?? "").trim().toLowerCase();
      const body = (m.body ?? "").trim();
      const createdAt = m.receivedAt ? new Date(m.receivedAt) : new Date();
      if (!isLikelyPlayerName(player)) return null;
      if (direction === "incoming" && isLikelyPollutedBody(body)) return null;
      if (direction === "incoming" && (m.externalId ?? "").startsWith("wim-")) return null;
      return {
        character,
        player,
        body,
        direction,
        status:
          direction === "outgoing"
            ? ((m.status ?? "sent") as "sent" | "pending" | "failed")
            : ("received" as const),
        externalId:
          m.externalId ??
          `sync-${character}-${player}-${createdAt.toISOString()}-${body.slice(0, 16)}`,
        createdAt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  if (rows.length === 0) return NextResponse.json({ inserted: 0, received: 0 });

  const visibleRows = await filterDeletedConversationGrace(rows);
  if (visibleRows.length === 0) {
    return NextResponse.json({ inserted: 0, received: rows.length, skipped: "recently_deleted" });
  }

  const uniqueRows = await filterDuplicateContent(visibleRows);
  if (uniqueRows.length === 0) {
    return NextResponse.json({ inserted: 0, received: rows.length });
  }

  const inserted = await db
    .insert(messages)
    .values(uniqueRows)
    .onConflictDoNothing({ target: messages.externalId })
    .returning({ id: messages.id });

  return NextResponse.json({ inserted: inserted.length, received: rows.length });
}

export async function GET() {
  const [row] = await db.select({ count: sql`count(*)::int` }).from(messages);
  return NextResponse.json({ ok: true, totalMessages: row?.count ?? 0 });
}
