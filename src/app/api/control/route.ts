import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { checkAdminAuth, checkBridgeAuth } from "@/lib/auth";
import { CONTROL_KEYS, readControls, type Controls } from "@/lib/control";

export async function GET(request: Request) {
  if (request.headers.get("authorization")) { const denied = await checkBridgeAuth(request); if (denied) return denied; }
  return Response.json({ controls: await readControls() });
}
export async function POST(request: Request) {
  const denied = checkAdminAuth(request); if (denied) return denied;
  const data = await request.json().catch(() => ({})) as Partial<Controls>;
  for (const [prop, key] of Object.entries(CONTROL_KEYS) as Array<[keyof Controls, string]>) {
    if (data[prop] === undefined) continue;
    const raw = data[prop];
    if (typeof raw !== "boolean" && !Number.isFinite(Number(raw))) return Response.json({ error: `Valor inválido para ${prop}` }, { status: 400 });
    const value = typeof raw === "boolean" ? (raw ? "yes" : "no") : String(Math.round(Number(raw)));
    await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  return Response.json({ controls: await readControls() });
}
