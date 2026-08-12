import { db } from "@/db";
import { messages, clientWindows, gseState } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public health endpoint used by Vercel and by BakersWhisper.exe.
 * It intentionally does NOT require BRIDGE_TOKEN so the desktop app can show
 * a clear "server reachable / db ok" indicator before doing authenticated
 * bridge calls.
 */
export async function GET() {
  const result: Record<string, unknown> = {
    ok: false,
    app: "Bakers Whisper",
    time: new Date().toISOString(),
    env: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasBridgeToken: Boolean(process.env.BRIDGE_TOKEN),
    },
    checks: {},
  };

  try {
    await db.execute(sql`select 1`);
    result.checks = { ...(result.checks as object), database: true };

    const [m] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages);
    const [w] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clientWindows);
    const [g] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gseState);

    result.ok = true;
    result.counts = {
      messages: m.count,
      windows: w.count,
      gseStates: g.count,
    };
    return Response.json(result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return Response.json(result, { status: 500 });
  }
}
