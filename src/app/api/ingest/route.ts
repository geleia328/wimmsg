import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
import { normalizeNameForStorage } from "@/lib/unicode";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  externalId?: string;
  external_id?: string;
  character?: string;
  char?: string;
  own?: string;
  player?: string;
  from?: string;
  to?: string;
  body?: string;
  text?: string;
  message?: string;
  receivedAt?: string;
  received_at?: string;
  createdAt?: string;
  direction?: "incoming" | "outgoing";
  status?: string;
};

type IncomingPayload = {
  messages?: IncomingMessage[];
  message?: IncomingMessage;
};

function isLikelyPlayerName(player: string): boolean {
  const p = player.trim().toLowerCase();
  if (p.length < 2 || p.length > 64) return false;
  if (!/[a-zà-ÿ]/i.test(p)) return false;
  if (/^\d+$/.test(p)) return false;
  if (
    [
      "unknown",
      "guild",
      "party",
      "raid",
      "system",
      "wim",
      "general",
      "comercio",
      "trade",
    ].includes(p)
  )
    return false;
  return true;
}

function isLikelyPollutedBody(body: string): boolean {
  const b = body.toLowerCase();
  return /\b(no do canal|intervalo|flood\s*&\s*queue|status:\s*desligado|criar link|exportar perfil|importar perfil|ligar sistema|todos os objetivos|missões|recompensas|comércio\s*-\s*cidade|guilda ativa|recruta dps|lf craft)\b/i.test(
    b,
  );
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
      deleted.set(
        t.key.replace(/^deleted_conversation:/, ""),
        Number(t.value) || 0,
      );
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

function parseEmbeddedRelay(
  body: string,
): {
  direction: "incoming" | "outgoing";
  character: string;
  player: string;
  body: string;
} | null {
  const normalized = body
    .replace(/[‹＜«]/g, "<")
    .replace(/WIM\s*RELAY/gi, "WIMRELAY")
    .replace(/BW\s*RELAY/gi, "BWRELAY");

  const from = normalized.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY|BWRELAY)?\s*<([^>]+?)>\s*<([^>]+?)>\s*(?:<[^>]+?>\s*)?(.*)$/i,
  );
  if (from) {
    return {
      direction: "incoming",
      character: from[1].trim(),
      player: from[2].trim(),
      body: from[3].trim(),
    };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  let payload: IncomingPayload | IncomingMessage[];
  try {
    payload = (await request.json()) as IncomingPayload | IncomingMessage[];
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawMessages: IncomingMessage[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
      ? payload.messages
      : payload?.message
        ? [payload.message]
        : [];

  if (rawMessages.length === 0) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const rows = rawMessages
    .map((m) => {
      const rawBody = (m.body ?? m.text ?? m.message ?? "").trim();
      const rawCharacter = (
        m.character ??
        m.char ??
        m.own ??
        "unknown"
      ).trim();
      const rawPlayer = (m.player ?? m.from ?? m.to ?? "").trim();

      if (!rawBody || !rawPlayer) return null;

      const relay = parseEmbeddedRelay(rawBody);
      const looksLikeBrokenRelay =
        /WIM\s*RELAY|BW\s*RELAY|<[^>]+>\s*<[^>]+>/i.test(rawBody);

      const character = relay?.character ?? rawCharacter;
      const player = relay?.player ?? rawPlayer;
      const body = relay?.body ?? rawBody;
      const direction: "incoming" | "outgoing" =
        relay?.direction ?? m.direction ?? "incoming";

      if (!isLikelyPlayerName(player)) return null;
      if (isLikelyPollutedBody(body)) return null;
      if (looksLikeBrokenRelay && !relay) return null;

      const externalId =
        m.externalId ??
        m.external_id ??
        `bridge-${character}-${player}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const ts = m.receivedAt ?? m.received_at ?? m.createdAt;

      return {
        character: normalizeNameForStorage(character),
        player: normalizeNameForStorage(player),
        body,
        direction,
        status: direction === "outgoing" ? (m.status ?? "sent") : "sent",
        externalId: externalId.slice(0, 128),
        createdAt: ts ? new Date(ts) : new Date(),
      };
    })
    .filter(
      (
        r,
      ): r is NonNullable<typeof r> & {
        direction: "incoming" | "outgoing";
      } => Boolean(r && r.player.length > 0 && r.body.length > 0),
    );

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const visibleRows = await filterDeletedConversationGrace(rows);
  if (visibleRows.length === 0) {
    return NextResponse.json({
      inserted: 0,
      received: rows.length,
      skipped: "recently_deleted",
    });
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

  return NextResponse.json({
    inserted: inserted.length,
    received: rows.length,
  });
}

export async function GET() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages);
  return NextResponse.json({ ok: true, totalMessages: row?.count ?? 0 });
}
