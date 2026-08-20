import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
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

type ParsedRelay = {
  direction: "incoming" | "outgoing";
  character: string;
  player: string;
  body: string;
};

function isLikelyPlayerName(player: string): boolean {
  const p = player.trim().toLowerCase();
  if (p.length < 3 || p.length > 64) return false;
  if (!/[a-zà-ÿ]/i.test(p)) return false;
  if (/^\d+$/.test(p)) return false;
  if (["unknown", "guild", "party", "raid", "system", "wim", "general", "comercio", "trade"].includes(p)) return false;
  return true;
}

function isLikelyPollutedBody(body: string): boolean {
  const b = body.toLowerCase();
  return /\b(no do canal|intervalo|flood\s*&\s*queue|status:\s*desligado|criar link|exportar perfil|importar perfil|ligar sistema|todos os objetivos|missões|recompensas|comércio\s*-\s*cidade|guilda ativa|recruta dps|lf craft)\b/i.test(b);
}

function parseEmbeddedRelay(body: string): ParsedRelay | null {
  const normalized = body
    .replace(/[‹＜«]/g, "<")
    .replace(/[›＞»]/g, ">")
    .replace(/WIM\s*RELAY/gi, "WIMRELAY")
    .replace(/BW\s*RELAY/gi, "BWRELAY");
  const from = normalized.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY|BWRELAY)?\s*<\s*OWN\s*:\s*([^>]+?)\s*>\s*<\s*FROM\s*:\s*([^>]+?)\s*>\s*(?:<\s*TS\s*:[^>]+?\s*>\s*)?([\s\S]*)$/i,
  );
  if (from) {
    return {
      direction: "incoming",
      character: from[1].trim(),
      player: from[2].trim(),
      body: from[3].trim(),
    };
  }
  const to = normalized.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY|BWRELAY)?\s*<\s*OWN\s*:\s*([^>]+?)\s*>\s*<\s*TO\s*:\s*([^>]+?)\s*>\s*(?:<\s*TS\s*:[^>]+?\s*>\s*)?([\s\S]*)$/i,
  );
  if (to) {
    return {
      direction: "outgoing",
      character: to[1].trim(),
      player: to[2].trim(),
      body: to[3].trim(),
    };
  }
  return null;
}

/**
 * The Python bridge posts newly-seen chat lines here. `character` identifies
 * WHICH of your WoW windows the message belongs to. We upsert by external_id
 * so re-posting is idempotent.
 */
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
      const rawCharacter = (m.character ?? m.char ?? m.own ?? "unknown").trim();
      const rawPlayer = (m.player ?? m.from ?? m.to ?? "").trim();
      if (!rawBody || !rawPlayer) return null;

      const relay = parseEmbeddedRelay(rawBody);
      const looksLikeBrokenRelay = /WIM\s*RELAY|BW\s*RELAY|<\s*OWN\s*:|<\s*FROM\s*:|<\s*TO\s*:/i.test(rawBody);
      if (!relay && looksLikeBrokenRelay) return null;

      const character = (relay?.character ?? rawCharacter).trim().toLowerCase() || "unknown";
      const player = (relay?.player ?? rawPlayer).trim().toLowerCase();
      const body = (relay?.body ?? rawBody).trim();
      const direction = relay?.direction ?? m.direction ?? "incoming";
      const isOutgoing = direction === "outgoing";
      if (!isLikelyPlayerName(player)) return null;
      if (!isOutgoing && isLikelyPollutedBody(body)) return null;
      // Whole-window WIM OCR from older bridge builds used externalId wim-* and
      // is the main source of random ads/UI pollution. Strip OCR uses ocr-*.
      if (!isOutgoing && (m.externalId ?? m.external_id ?? "").startsWith("wim-")) return null;
      const receivedAt = m.receivedAt ?? m.received_at ?? m.createdAt;
      return {
        character,
        player,
        body,
        direction: isOutgoing ? ("outgoing" as const) : ("incoming" as const),
        status: isOutgoing
          ? ((m.status ?? "sent") as "sent" | "failed")
          : ("received" as const),
        externalId:
          m.externalId ??
          m.external_id ??
          `${character}-${player}-${receivedAt ?? new Date().toISOString()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        createdAt: receivedAt ? new Date(receivedAt) : new Date(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r && r.player.length > 0 && r.body.length > 0));

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const uniqueRows = await filterDuplicateContent(rows);
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
