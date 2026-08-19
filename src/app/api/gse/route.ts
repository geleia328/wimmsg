import { db } from "@/db";
import { gseState } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { asc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(gseState).orderBy(asc(gseState.character));
  return Response.json({ states: rows.map((row) => ({ ...row, running: row.running === "yes", intervalMs: Number(row.intervalMs) })) });
}
export async function POST(request: Request) {
  if (request.headers.get("authorization")) { const denied = await checkBridgeAuth(request); if (denied) return denied; }
  const data = await request.json().catch(() => ({})) as { action?: string; characters?: string[] }; const running = data.action === "startAll" ? "yes" : data.action === "stopAll" ? "no" : null;
  if (!running) return Response.json({ error: "Ação inválida" }, { status: 400 });
  if (data.characters?.length) for (const character of data.characters) await db.insert(gseState).values({ character: character.slice(0,128), running }).onConflictDoUpdate({ target: gseState.character, set: { running, updatedAt: new Date() } });
  else await db.update(gseState).set({ running, updatedAt: new Date() });
  return Response.json({ ok: true });
}
