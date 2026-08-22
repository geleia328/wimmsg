import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { filterDuplicateContent } from "@/lib/dedupe";
import { isLikelyPlayerName, isLikelyPollutedBody } from "@/lib/shared";
import { canonicalName } from "@/lib/realm";
import { normalizeNameForStorage } from "@/lib/unicode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Endpoint de sincronização histórica/viva usado pelo bridge (BakersWhisper.exe).
 * Aceita o mesmo formato do /api/ingest, mas existe separado porque builds
 * antigos chamam /api/sync ao ler as últimas linhas do WoWChatLog.txt.
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
      const direction =
        m.direction === "outgoing" ? ("outgoing" as const) : ("incoming" as const);
      const cleanPlayer = canonicalName(m.player ?? "");
      const cleanCharacter =
        canonicalName(m.character || "unknown") ?? "unknown";
      return {
        character: cleanCharacter,
        player: cleanPlayer ?? normalizeNameForStorage(m.player ?? ""),
        body: (m.body ?? "").trim(),
        direction,
        status: direction === "outgoing" ? (m.status ?? "sent") : "sent",
        externalId: (
          m.externalId ??
          `sync-${m.character}-${m.player}-${m.body}-${m.receivedAt ?? ""}`
        ).slice(0, 128),
        createdAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
      };
    })
    .filter(
      (r) =>
        r.player &&
        isLikelyPlayerName(r.player) &&
        !isLikelyPollutedBody(r.body) &&
        r.body.length > 0,
    );

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, received: raw.length });
  }

  const uniqueRows = await filterDuplicateContent(rows);
  if (uniqueRows.length === 0) {
    return NextResponse.json({ inserted: 0, received: raw.length });
  }

  const inserted = await db
    .insert(messages)
    .values(uniqueRows)
    .onConflictDoNothing({ target: messages.externalId })
    .returning({ id: messages.id });

  return NextResponse.json({ inserted: inserted.length, received: raw.length });
}
