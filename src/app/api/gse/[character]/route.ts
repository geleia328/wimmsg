import { db } from "@/db";
import { gseState } from "@/db/schema";

export async function POST(request: Request, { params }: { params: Promise<{ character: string }> }) {
  const { character } = await params; const data = await request.json().catch(() => ({})) as { running?: boolean; keybind?: string; intervalMs?: number };
  const values = { character: character.slice(0,128), running: data.running === undefined ? "no" : data.running ? "yes" : "no", keybind: String(data.keybind ?? "1").slice(0,32), intervalMs: String(Math.min(2000, Math.max(50, Number(data.intervalMs) || 100))), updatedAt: new Date() };
  const rows = await db.insert(gseState).values(values).onConflictDoUpdate({ target: gseState.character, set: values }).returning();
  return Response.json({ state: { ...rows[0], running: rows[0].running === "yes", intervalMs: Number(rows[0].intervalMs) } });
}
