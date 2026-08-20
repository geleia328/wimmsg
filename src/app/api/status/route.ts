import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { checkBridgeAuth } from "@/lib/auth";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → current inventory of WoW client windows. The Python bridge also reads
 * this to know which window maps to which character.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth) {
    const guard = await checkBridgeAuth(request);
    if (!guard.ok) return guard.response;
  }
  const windows = await db
    .select()
    .from(clientWindows)
    .orderBy(desc(clientWindows.lastSeen));
  return NextResponse.json({ windows });
}
