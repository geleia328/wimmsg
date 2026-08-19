import { db } from "@/db";
import { appSettings, clientWindows, gseState, messages } from "@/db/schema";
import { checkAdminAuth } from "@/lib/auth";
import { maskSecret } from "@/lib/shared";
import { count, eq } from "drizzle-orm";

async function safeCount(table: typeof messages | typeof clientWindows | typeof gseState | typeof appSettings) { try { const row = await db.select({ value: count() }).from(table); return { ok: true, count: row[0].value }; } catch (error) { return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }; } }
export async function GET(request: Request) {
  const denied = checkAdminAuth(request); if (denied) return denied;
  let dynamicToken = ""; try { dynamicToken = (await db.select().from(appSettings).where(eq(appSettings.key, "bridge_token")).limit(1))[0]?.value ?? ""; } catch {}
  const [m,w,g,s] = await Promise.all([safeCount(messages),safeCount(clientWindows),safeCount(gseState),safeCount(appSettings)]);
  const tables = { messages:m, windows:w, gseState:g, appSettings:s };
  return Response.json({ databaseUrl: maskSecret(process.env.DATABASE_URL), envConfigured: { databaseUrl: Boolean(process.env.DATABASE_URL), bridgeToken: Boolean(process.env.BRIDGE_TOKEN), adminToken: Boolean(process.env.ADMIN_TOKEN) }, dynamicConfigured: Boolean(dynamicToken), dynamicToken: maskSecret(dynamicToken), counts: { messages:m.count, windows:w.count, gseState:g.count, appSettings:s.count }, tableErrors: Object.fromEntries(Object.entries(tables).filter(([,v])=>!v.ok).map(([k,v])=>[k,v.error])), tablesReady: Object.values(tables).every((v)=>v.ok) });
}
export async function POST(request: Request) {
  const denied = checkAdminAuth(request); if (denied) return denied;
  const data = await request.json().catch(() => ({})) as { bridgeToken?: string }; const value = data.bridgeToken?.trim() ?? "";
  if (value.length < 16) return Response.json({ error: "Use um token com pelo menos 16 caracteres" }, { status: 400 });
  await db.insert(appSettings).values({ key:"bridge_token", value }).onConflictDoUpdate({ target: appSettings.key, set:{ value, updatedAt:new Date() } });
  return Response.json({ ok:true, masked:maskSecret(value) });
}
