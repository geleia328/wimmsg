import { db } from "@/db";
import { appSettings, clientWindows, gseState, messages } from "@/db/schema";
import { errorDetails, maskSecret } from "@/lib/shared";
import { count, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export async function GET() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const env = { hasDatabaseUrl: Boolean(databaseUrl), databaseUrl: maskSecret(databaseUrl), hasBridgeToken: Boolean(process.env.BRIDGE_TOKEN) };
  try {
    await db.execute(sql`select 1`);
    const [m, w, g, s] = await Promise.all([db.select({ value: count() }).from(messages), db.select({ value: count() }).from(clientWindows), db.select({ value: count() }).from(gseState), db.select({ value: count() }).from(appSettings)]);
    return Response.json({ ok: true, app: "Bakers Whisper", time: new Date().toISOString(), env: { hasDatabaseUrl: env.hasDatabaseUrl, maskedDatabaseUrl: env.databaseUrl, hasBridgeToken: env.hasBridgeToken }, checks: { database: true }, counts: { messages: m[0].value, windows: w[0].value, gseStates: g[0].value, appSettings: s[0].value } });
  } catch (error) {
    return Response.json({ ok: false, env, error: errorDetails(error), help: ["Use a DATABASE_URL Pooled do Neon.", "Confirme sslmode=require na URL.", "Após alterar variáveis na Vercel, faça um novo deploy.", "Crie as tabelas em /settings ou com npx drizzle-kit push."] }, { status: 500 });
  }
}
