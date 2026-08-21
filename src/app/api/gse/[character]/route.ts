import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gseState } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ character: string }> },
) {
  const { character } = await params;
  const target = decodeURIComponent(character).toLowerCase();
  const [found] = await db
    .select()
    .from(gseState)
    .where(eq(gseState.character, target))
    .limit(1);

  if (!found) {
    return NextResponse.json({
      character: target,
      running: false,
      keybind: "1",
      intervalMs: 100,
    });
  }
  return NextResponse.json({
    character: found.character,
    running: found.running === "yes",
    keybind: found.keybind,
    intervalMs: Number(found.intervalMs) || 100,
    updatedAt: found.updatedAt,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ character: string }> },
) {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const guard = await checkBridgeAuth(request);
    if (!guard.ok) return guard.response;
  }

  const { character } = await params;
  const target = decodeURIComponent(character).toLowerCase();

  let payload: {
    running?: boolean;
    keybind?: string;
    intervalMs?: number;
  } = {};
  try {
    payload = await request.json();
  } catch {
    // empty body is allowed
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof payload.running === "boolean") {
    set.running = payload.running ? "yes" : "no";
  }
  if (typeof payload.keybind === "string" && payload.keybind.trim()) {
    set.keybind = payload.keybind.trim();
  }
  if (typeof payload.intervalMs === "number") {
    set.intervalMs = String(
      Math.max(50, Math.min(60000, Math.floor(payload.intervalMs))),
    );
  }

  await db
    .insert(gseState)
    .values({
      character: target,
      running:
        typeof payload.running === "boolean"
          ? payload.running
            ? "yes"
            : "no"
          : "no",
      keybind: payload.keybind?.trim() || "1",
      intervalMs:
        typeof payload.intervalMs === "number"
          ? String(
              Math.max(10, Math.min(60000, Math.floor(payload.intervalMs))),
            )
          : "100",
    })
    .onConflictDoUpdate({
      target: gseState.character,
      set,
    });

  return NextResponse.json({ ok: true, character: target, ...payload });
}

// A character can be present only in the bridge's live-window list, without a
// saved GSE row yet. Deleting that entry is still a successful no-op: it keeps
// the UI resilient and avoids showing a false "failed to remove" message.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ character: string }> },
) {
  const { character } = await params;
  const target = decodeURIComponent(character).trim().toLowerCase();
  if (!target) {
    return NextResponse.json({ error: "invalid_character" }, { status: 400 });
  }

  await db
    .delete(gseState)
    .where(sql`lower(${gseState.character}) = ${target}`);

  return NextResponse.json({ ok: true, character: target });
}
