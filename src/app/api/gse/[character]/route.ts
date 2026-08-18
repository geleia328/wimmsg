import { db } from "@/db";
import { gseState } from "@/db/schema";
import { checkAdminAuth, unauthorized } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ character: string }> };

export async function GET(req: Request, { params }: Params) {
  const { character } = await params;
  const c = decodeURIComponent(character);
  const rows = await db.execute<{ character: string; running: string; keybind: string; interval_ms: string }>(sql`
    select character, running, keybind, interval_ms from gse_state where lower(character) = lower(${c})
  `);
  const row = rows.rows?.[0];
  if (!row) return Response.json({ ok: true, character: null });
  return Response.json({
    ok: true,
    character: {
      character: row.character,
      running: row.running,
      keybind: row.keybind,
      intervalMs: row.interval_ms,
    },
  });
}

export async function POST(req: Request, { params }: Params) {
  if (!checkAdminAuth(req)) return unauthorized();
  const { character } = await params;
  const c = decodeURIComponent(character);
  let payload: { running?: string; keybind?: string; intervalMs?: string | number } = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const running = payload.running === "yes" ? "yes" : "no";
  const keybind = String(payload.keybind || "1").slice(0, 32);
  const intervalMs = String(payload.intervalMs ?? 120).slice(0, 16);
  await db.execute(sql`
    insert into gse_state (character, running, keybind, interval_ms, updated_at)
    values (${c}, ${running}, ${keybind}, ${intervalMs}, now())
    on conflict (character) do update set
      running = excluded.running,
      keybind = excluded.keybind,
      interval_ms = excluded.interval_ms,
      updated_at = now()
  `);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!checkAdminAuth(req)) return unauthorized();
  const { character } = await params;
  const c = decodeURIComponent(character);
  await db.execute(sql`delete from gse_state where lower(character) = lower(${c})`);
  // Silence unused warnings
  void gseState;
  return Response.json({ ok: true });
}
