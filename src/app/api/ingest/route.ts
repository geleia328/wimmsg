import { db } from "@/db";
import { messages } from "@/db/schema";
import { checkBridgeAuth, unauthorized, parseRelayBody } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type IncomingMsg = {
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
  const list: IncomingMsg[] = Array.isArray((payload as { messages?: unknown })?.messages)
    ? ((payload as { messages: IncomingMsg[] }).messages)
    : Array.isArray(payload)
    ? (payload as IncomingMsg[])
    : [payload as IncomingMsg];

  let inserted = 0;
  let skipped = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    let character = String(raw.character || "").trim();
    let player = String(raw.player || "").trim();
    let body = String(raw.body || "").trim();
    let direction: "incoming" | "outgoing" =
      raw.direction === "outgoing" ? "outgoing" : "incoming";

    // Defensive: parse WIMRELAY/WIMBRIDGE markers from body if bridge sent raw
    const parsed = parseRelayBody(character, player, body);
    if (parsed) {
      character = parsed.character;
      player = parsed.player;
      body = parsed.body;
      direction = parsed.direction;
    }

    if (!character || !player || !body) {
      skipped++;
      continue;
    }
    const externalId = raw.externalId ? String(raw.externalId) : null;
    const status = raw.status ? String(raw.status) : direction === "incoming" ? "received" : "pending";
    try {
      const values: typeof messages.$inferInsert = {
        character,
        player,
        body,
        direction,
        status,
        externalId,
      };
      if (raw.receivedAt) {
        const d = new Date(raw.receivedAt);
        if (!isNaN(d.getTime())) values.createdAt = d;
      }
      if (externalId) {
        // ON CONFLICT DO NOTHING via raw
        await db.execute(sql`
          insert into messages (character, player, direction, body, status, external_id, created_at)
          values (${character}, ${player}, ${direction}, ${body}, ${status}, ${externalId}, ${values.createdAt ?? new Date()})
          on conflict (external_id) do nothing
        `);
      } else {
        await db.insert(messages).values(values);
      }
      inserted++;
    } catch (e) {
      skipped++;
      console.error("[ingest] insert error", e);
    }
  }
  return Response.json({ ok: true, inserted, skipped, total: list.length });
}
