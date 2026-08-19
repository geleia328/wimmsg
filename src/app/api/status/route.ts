import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export async function GET() {
  const now = Date.now();
  const rows = await db.select().from(clientWindows).orderBy(desc(clientWindows.lastSeen));
  return Response.json({ windows: rows.map((row) => {
    const secondsAgo = Math.max(0, Math.floor((now - row.lastSeen.getTime()) / 1000));
    return { ...row, foreground: row.foreground === "yes", matched: row.matched === "yes", online: secondsAgo < 15, secondsAgo };
  }) });
}
