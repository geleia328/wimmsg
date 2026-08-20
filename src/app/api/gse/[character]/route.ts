import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gseState } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST body:
 *   { running?: boolean, keybind?: string, intervalMs?: number }
 *
 * Upserts the row so a character can be enabled even before the bridge has
 * scanned it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ character: string }> },
) {
  const { character: raw } = await context.params;
  const character = decodeURIComponent(raw).trim();
  if (!character) {
    return NextResponse.json({ error: "character required" }, { status: 400 });
  }

  let body: {
    running?: boolean;
    keybind?: string;
    intervalMs?: number;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Sanitize
  const keybind =
    typeof body.keybind === "string" && body.keybind.length > 0
      ? body.keybind.slice(0, 32)
      : undefined;
  // Allow any practical interval the user wants (50ms .. 10 min).
  // The old 2000ms hard-cap blocked slower GSE rotations.
  const intervalMs =
    typeof body.intervalMs === "number" && Number.isFinite(body.intervalMs)
      ? String(Math.max(50, Math.min(600_000, Math.floor(body.intervalMs))))
      : undefined;

  const patch: {
    running?: "yes" | "no";
    keybind?: string;
    intervalMs?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (typeof body.running === "boolean") {
    patch.running = body.running ? "yes" : "no";
  }
  if (keybind) patch.keybind = keybind;
  if (intervalMs) patch.intervalMs = intervalMs;

  // Upsert
  const [existing] = await db
    .select()
    .from(gseState)
    .where(eq(gseState.character, character));

  if (existing) {
    const [updated] = await db
      .update(gseState)
      .set(patch)
      .where(eq(gseState.character, character))
      .returning();
    return NextResponse.json({ ok: true, state: updated });
  }
  const [inserted] = await db
    .insert(gseState)
    .values({
      character,
      running: patch.running ?? "no",
      keybind: patch.keybind ?? "1",
      intervalMs: patch.intervalMs ?? "100",
    })
    .returning();
  return NextResponse.json({ ok: true, state: inserted });
}

/**
 * DELETE → removes the GSE row for a character.
 * Useful when the user changes characters / accounts.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ character: string }> },
) {
  const { character: raw } = await context.params;
  const character = decodeURIComponent(raw).trim();
  if (!character) {
    return NextResponse.json({ error: "character required" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(gseState)
    .where(eq(gseState.character, character))
    .returning({ character: gseState.character });

  if (!deleted) {
    return NextResponse.json(
      { error: "character_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, removed: deleted.character });
}
