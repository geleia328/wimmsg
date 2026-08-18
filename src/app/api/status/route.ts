import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(clientWindows).orderBy(desc(clientWindows.lastSeen)).limit(200);
  return Response.json({ ok: true, windows: rows });
}
