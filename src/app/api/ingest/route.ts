import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingPayload = {
  messages: Array<{
    externalId?: string;
    character: string;
    player: string;
    body: string;
    receivedAt?: string;
    /**
     * The bridge posts BOTH sides of the chat:
     *  - "incoming" (default): a whisper RECEIVED in this window
     *    (from the addon echo or the native `[W From]` chat log line).
     *  - "outgoing": a whisper SENT from this window, e.g. typed in-game and
     *    captured from the native `[W To]` chat log line. This makes sure
     *    replies typed inside WoW are never lost and show up in the site.
     */
    direction?: "incoming" | "outgoing";
    status?: string;
  }>;
};

type ParsedRelay = {
  direction: "incoming" | "outgoing";
  character: string;
  player: string;
  body: string;
};

function parseEmbeddedRelay(body: string): ParsedRelay | null {
  const from = body.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY)<OWN:([^>]+)><FROM:([^>]+)>(?:<TS:[^>]+>)?(.*)$/,
  );
  if (from) {
    return {
      direction: "incoming",
      character: from[1].trim(),
      player: from[2].trim(),
      body: from[3].trim(),
    };
  }
  const to = body.match(
    /(?:\[WIMBRIDGE\]|WIMRELAY)<OWN:([^>]+)><TO:([^>]+)>(?:<TS:[^>]+>)?(.*)$/,
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

  let payload: IncomingPayload;
  try {
    payload = (await request.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload || !Array.isArray(payload.messages)) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const rows = payload.messages
    .filter(
      (m) =>
        m &&
        typeof m.player === "string" &&
        typeof m.body === "string" &&
        typeof m.character === "string",
    )
    .map((m) => {
      // Defensive server-side parser: if an older bridge parsed the relay line
      // incorrectly as body="WIMRELAY<OWN...>", fix it here before storing.
      const relay = parseEmbeddedRelay(m.body);
      const character = (relay?.character ?? m.character.trim()) || "unknown";
      const player = relay?.player ?? m.player.trim();
      const body = relay?.body ?? m.body;
      const direction = relay?.direction ?? m.direction ?? "incoming";
      const isOutgoing = direction === "outgoing";
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
          `${character}-${player}-${m.receivedAt ?? new Date().toISOString()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        createdAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
      };
    })
    .filter((r) => r.player.length > 0 && r.body.length > 0);

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  // Belt-and-suspenders: drop rows whose content already exists within ~8s
  // (covers relay + native + voice + history-sync-on-restart duplicates that
  // carry different externalIds).
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
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages);
  return NextResponse.json({ ok: true, totalMessages: count });
}
