import { db } from "@/db";
import { gseState } from "@/db/schema";
import { checkAdminAuth, unauthorized } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(gseState);
  return Response.json({ ok: true, characters: rows });
}

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) return unauthorized();
  let payload: unknown;
  try { payload = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const list = Array.isArray((payload as { characters?: unknown })?.characters)
    ? ((payload as { characters: Array<{ character: string; running?: string; keybind?: string; intervalMs?: string | number }> }).characters)
    : [];
  for (const c of list) {
    const character = String(c.character || "").trim();
    if (!character) continue;
    const running = c.running === "yes" ? "yes" : "no";
    const keybind = String(c.keybind || "1").slice(0, 32);
    const intervalMs = String(c.intervalMs ?? 120).slice(0, 16);
    await db.execute(sql`
      insert into gse_state (character, running, keybind, interval_ms, updated_at)
      values (${character}, ${running}, ${keybind}, ${intervalMs}, now())
      on conflict (character) do update set
        running = excluded.running,
        keybind = excluded.keybind,
        interval_ms = excluded.interval_ms,
        updated_at = now()
    `);
  }
  return Response.json({ ok: true });
}
