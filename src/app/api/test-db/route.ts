import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.select({
      id: messages.id,
      character: messages.character,
      player: messages.player,
      direction: messages.direction,
      body: messages.body,
      externalId: messages.externalId,
    }).from(messages);
    return NextResponse.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
