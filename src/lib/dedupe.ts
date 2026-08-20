import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, gte, lte } from "drizzle-orm";

export type DedupableRow = {
  character: string;
  player: string;
  body: string;
  direction: "incoming" | "outgoing";
  createdAt: Date;
};

const BUCKET_MS = 8000;
const MARGIN_MS = 20_000;

/**
 * Content-level dedupe across capture paths (relay channel line, native
 * [W From]/[W To] line, voice relay, history sync on every "Iniciar").
 *
 * externalId is deterministic per log line, but different paths produce
 * different ids for the SAME real whisper. This drops a candidate row when an
 * identical (character, player, body, direction) message already exists within
 * ~8s — so history reloads and multi-path captures never duplicate in the UI.
 */
export async function filterDuplicateContent<T extends DedupableRow>(
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  // Look up DB rows in a window AROUND the candidates' own timestamps
  // (history syncs carry past dates, so a "now - 10min" window would miss them).
  const times = rows
    .map((r) => new Date(r.createdAt).getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return rows;

  const minT = Math.min(...times) - MARGIN_MS;
  const maxT = Math.max(...times, Date.now()) + MARGIN_MS;

  let recent: Array<{
    character: string;
    player: string;
    body: string;
    direction: string;
    createdAt: Date;
  }>;
  try {
    recent = await db
      .select({
        character: messages.character,
        player: messages.player,
        body: messages.body,
        direction: messages.direction,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          gte(messages.createdAt, new Date(minT)),
          lte(messages.createdAt, new Date(maxT)),
        ),
      )
      .limit(5000);
  } catch {
    return rows;
  }

  const keys = new Set<string>();
  for (const m of recent) {
    const b = Math.floor(new Date(m.createdAt).getTime() / BUCKET_MS);
    keys.add(
      `${m.character.toLowerCase()}|${m.player.toLowerCase()}|${m.body}|${m.direction}|${b}`,
    );
  }

  // Also dedupe identical rows inside the same batch.
  return rows.filter((r) => {
    const t = new Date(r.createdAt).getTime();
    const b = Math.floor(t / BUCKET_MS);
    const base = `${r.character.toLowerCase()}|${r.player.toLowerCase()}|${r.body}|${r.direction}|`;
    for (const bb of [b - 1, b, b + 1]) {
      if (keys.has(base + bb)) return false;
    }
    keys.add(`${base}${b}`);
    return true;
  });
}
