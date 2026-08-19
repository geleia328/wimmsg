import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Public healthcheck (no auth). Confirms the DB is reachable so the platform
 * and the desktop bridge can both verify the server is alive.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, service: "bakers-whisper" });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
