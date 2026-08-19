import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { lt } from "drizzle-orm";

export async function POST(request: Request) {
  const denied = await checkBridgeAuth(request); if (denied) return denied;
  const data = await request.json().catch(() => ({})) as { windows?: Array<Record<string, unknown>> };
  const valid = (data.windows ?? []).filter((w) => String(w.hwnd ?? "").trim() && String(w.windowTitle ?? "").trim()).slice(0, 100);
  for (const w of valid) {
    const row = { character: String(w.character ?? "").slice(0,128), windowTitle: String(w.windowTitle).slice(0,255), pid: String(w.pid ?? "").slice(0,32), hwnd: String(w.hwnd).slice(0,32), foreground: w.foreground ? "yes" : "no", matched: w.matched ? "yes" : "no", slot: String(w.slot ?? "").slice(0,8), realm: String(w.realm ?? "").slice(0,64), lastSeen: new Date() };
    await db.insert(clientWindows).values(row).onConflictDoUpdate({ target: clientWindows.hwnd, set: row });
  }
  await db.delete(clientWindows).where(lt(clientWindows.lastSeen, new Date(Date.now() - 30000)));
  return Response.json({ scanned: valid.length });
}
