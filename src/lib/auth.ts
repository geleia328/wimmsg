import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export function checkAdminAuth(request: Request): Response | null {
  const expected = (process.env.ADMIN_TOKEN || process.env.BRIDGE_TOKEN || "").trim();
  const provided = (request.headers.get("x-admin-token") || bearer(request)).trim();
  if (!expected || provided === expected) return null;
  return Response.json({ error: "Não autorizado" }, { status: 401 });
}

export async function checkBridgeAuth(request: Request): Promise<Response | null> {
  const provided = bearer(request);
  const envToken = (process.env.BRIDGE_TOKEN || "").trim();
  if (envToken && provided === envToken) return null;
  let dbToken = "";
  try {
    const row = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "bridge_token")).limit(1);
    dbToken = row[0]?.value?.trim() ?? "";
  } catch { /* database may not be initialized */ }
  if (dbToken && provided === dbToken) return null;
  if (!envToken && !dbToken) return null;
  return Response.json({ error: "Token bridge inválido" }, { status: 401 });
}
