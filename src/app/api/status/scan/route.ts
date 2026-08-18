import { db } from "@/db";
import { clientWindows } from "@/db/schema";
import { checkBridgeAuth, unauthorized } from "@/lib/auth";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Win = {
  character?: string;
  windowTitle?: string;
  pid?: string | number;
  hwnd?: string | number;
  foreground?: boolean;
  matched?: boolean;
  slot?: string;
  realm?: string;
};

export async function POST(req: Request) {
  if (!checkBridgeAuth(req)) return unauthorized();
  let payload: unknown;
  try { payload = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const list: Win[] = Array.isArray((payload as { windows?: unknown })?.windows)
    ? ((payload as { windows: Win[] }).windows)
    : Array.isArray(payload)
    ? (payload as Win[])
    : [];
  // Clear old, insert fresh snapshot
  await db.execute(sql`truncate table client_windows restart identity`);
  for (const w of list) {
    try {
      await db.insert(clientWindows).values({
        character: w.character ? String(w.character) : null,
        windowTitle: w.windowTitle ? String(w.windowTitle) : null,
        pid: w.pid != null ? String(w.pid) : null,
        hwnd: w.hwnd != null ? String(w.hwnd) : null,
        foreground: w.foreground ? "yes" : "no",
        matched: w.matched ? "yes" : "no",
        slot: w.slot ? String(w.slot) : null,
        realm: w.realm ? String(w.realm) : null,
      });
    } catch (e) {
      console.error("[status/scan] insert error", e);
    }
  }
  return Response.json({ ok: true, count: list.length });
}
