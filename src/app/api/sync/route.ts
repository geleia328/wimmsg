import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth, unauthorized, sameName, parseRelayBody } from "@/lib/auth";
import { and, desc, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const character = (url.searchParams.get("character") || "").trim();
  const player = (url.searchParams.get("player") || "").trim();
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  if (!character || !player) {
    return Response.json({ ok: false, error: "character and player required" }, { status: 400 });
  }
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        sql`lower(${messages.character}) = lower(${character})`,
        sql`lower(${messages.player}) = lower(${player})`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return Response.json({ ok: true, messages: rows.reverse() });
}

type SyncMsg = {
  externalId?: string;
  character: string;
  player: string;
  body: string;
  direction?: "incoming" | "outgoing";
  status?: string;
  receivedAt?: string;
};

export async function POST(req: Request) {
  if (!checkBridgeAuth(req)) return unauthorized();
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const list: SyncMsg[] = Array.isArray((payload as { messages?: unknown })?.messages)
    ? ((payload as { messages: SyncMsg[] }).messages)
    : Array.isArray(payload)
    ? (payload as SyncMsg[])
    : [payload as SyncMsg];
  let inserted = 0;
  let skipped = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    let character = String(raw.character || "").trim();
    let player = String(raw.player || "").trim();
    let body = String(raw.body || "").trim();
    let direction: "incoming" | "outgoing" = raw.direction === "outgoing" ? "outgoing" : "incoming";
    const parsed = parseRelayBody(character, player, body);
    if (parsed) {
      character = parsed.character;
      player = parsed.player;
      body = parsed.body;
      direction = parsed.direction;
    }
    if (!character || !player || !body) { skipped++; continue; }
    const externalId = raw.externalId ? String(raw.externalId) : null;
    const status = raw.status ? String(raw.status) : direction === "incoming" ? "received" : "sent";
    const createdAt = raw.receivedAt ? new Date(raw.receivedAt) : new Date();
    try {
      if (externalId) {
        await db.execute(sql`
          insert into messages (character, player, direction, body, status, external_id, created_at)
          values (${character}, ${player}, ${direction}, ${body}, ${status}, ${externalId}, ${createdAt})
          on conflict (external_id) do nothing
        `);
      } else {
        await db.insert(messages).values({ character, player, direction, body, status, createdAt });
      }
      inserted++;
    } catch (e) {
      skipped++;
      console.error("[sync] insert error", e);
    }
  }
  // Silence unused import warnings
  void or; void and; void desc; void sameName;
  return Response.json({ ok: true, inserted, skipped, total: list.length });
}
