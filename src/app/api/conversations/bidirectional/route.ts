import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { asc, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Direction = "incoming" | "outgoing";

type RawMessage = typeof messages.$inferSelect;

type NormalizedMessage = RawMessage & {
  sourceCharacter: string;
  sourcePlayer: string;
  sourceDirection: string;
};

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function normalizeForViewer(row: RawMessage, viewer: string, other: string): NormalizedMessage {
  const isViewerRow = sameName(row.character, viewer) && sameName(row.player, other);
  const normalizedDirection: Direction = isViewerRow
    ? (row.direction as Direction)
    : row.direction === "outgoing"
      ? "incoming"
      : "outgoing";

  return {
    ...row,
    // Important: make the message relative to the currently-open chat.
    // If you are looking at madelina↔taldoglaidon, rows originally stored as
    // taldoglaidon→madelina must appear as INCOMING for madelina.
    character: viewer,
    player: other,
    direction: normalizedDirection,
    status:
      normalizedDirection === "incoming"
        ? "received"
        : row.status === "received"
          ? "sent"
          : row.status,
    sourceCharacter: row.character,
    sourcePlayer: row.player,
    sourceDirection: row.direction,
  };
}

function strength(status: string): number {
  if (status === "sent" || status === "received") return 3;
  if (status === "pending") return 2;
  if (status === "failed") return 1;
  return 0;
}

/**
 * Collapses mirror duplicates.
 *
 * Example:
 *  - madelina outgoing "salve" (created when sending from the site)
 *  - taldoglaidon incoming "salve" (captured from the game/WIM)
 *
 * Both represent the same chat bubble when viewing madelina↔taldoglaidon.
 */
function collapseMirrors(rows: NormalizedMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const row of rows) {
    const t = new Date(row.createdAt).getTime();
    const dupIndex = out.findIndex((prev) => {
      const pt = new Date(prev.createdAt).getTime();
      return (
        prev.direction === row.direction &&
        prev.body === row.body &&
        Math.abs(t - pt) <= 15_000
      );
    });

    if (dupIndex < 0) {
      out.push(row);
      continue;
    }

    const prev = out[dupIndex];
    if (strength(row.status) > strength(prev.status)) {
      out[dupIndex] = { ...row, createdAt: prev.createdAt };
    }
  }
  return out;
}

/**
 * GET /api/conversations/bidirectional?charA=Madelina-Gallywix&charB=Taldoglaidon-Gallywix
 *
 * Returns a NORMAL messenger view: all messages between charA and charB,
 * normalized relative to charA.
 */
export async function GET(request: NextRequest) {
  const charA = request.nextUrl.searchParams.get("charA");
  const charB = request.nextUrl.searchParams.get("charB");

  if (!charA || !charB) {
    return NextResponse.json({ error: "charA and charB required" }, { status: 400 });
  }

  const charALower = charA.toLowerCase();
  const charBLower = charB.toLowerCase();

  const rows = await db
    .select()
    .from(messages)
    .where(sql/* sql */ `
      (
        lower(${messages.character}) = ${charALower}
        AND lower(${messages.player}) = ${charBLower}
      ) OR (
        lower(${messages.character}) = ${charBLower}
        AND lower(${messages.player}) = ${charALower}
      )
    `)
    .orderBy(asc(messages.createdAt))
    .limit(200);

  const normalized = rows.map((row) => normalizeForViewer(row, charA, charB));
  const collapsed = collapseMirrors(normalized);

  return NextResponse.json({
    charA,
    charB,
    messages: collapsed,
  });
}
