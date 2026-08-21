import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gseState } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(gseState);
  return NextResponse.json({
    states: rows.map((r) => ({
      character: r.character,
      running: r.running === "yes",
      keybind: r.keybind,
      intervalMs: Number(r.intervalMs) || 100,
      updatedAt: r.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const guard = await checkBridgeAuth(request);
    if (!guard.ok) return guard.response;
  }

  let payload: { action?: "startAll" | "stopAll"; characters?: string[] } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const target = payload.action === "startAll" ? "yes" : "no";
  if (!["startAll", "stopAll"].includes(payload.action ?? "")) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  if (payload.characters && payload.characters.length > 0) {
    for (const c of payload.characters) {
      const character = c.trim().toLowerCase();
      if (!character) continue;
      await db
        .insert(gseState)
        .values({ character, running: target })
        .onConflictDoUpdate({
          target: gseState.character,
          set: { running: target, updatedAt: new Date() },
        });
    }
    return NextResponse.json({ ok: true, affected: payload.characters.length });
  }

  await db.execute(sql/* sql */ `
    UPDATE ${gseState}
    SET running = ${target}, updated_at = now()
  `);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gseState);
  return NextResponse.json({ ok: true, affected: row?.count ?? 0 });
}
