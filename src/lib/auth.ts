import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/**
 * Admin guard used by /settings APIs.
 *
 * The admin key is, in order:
 *   1. ADMIN_TOKEN env var, if set
 *   2. BRIDGE_TOKEN env var, fallback
 *
 * This keeps the settings page protected without introducing user accounts.
 */
export function checkAdminAuth(
  request: Request,
): { ok: true } | { ok: false; response: Response } {
  const expected = process.env.ADMIN_TOKEN || process.env.BRIDGE_TOKEN;
  if (!expected) return { ok: true };

  const provided =
    request.headers.get("x-admin-token")?.trim() || bearer(request);

  if (provided !== expected) {
    return {
      ok: false,
      response: jsonResponse({ error: "unauthorized" }, 401),
    };
  }
  return { ok: true };
}

/**
 * Bridge guard used by Python/EXE endpoints.
 *
 * Accepted tokens:
 *   - BRIDGE_TOKEN env var (works before DB settings are configured)
 *   - app_settings.bridge_token (editable from /settings once DB is online)
 *
 * If neither token exists, dev mode allows requests.
 */
export async function checkBridgeAuth(
  request: Request,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const provided = bearer(request);
  const envToken = process.env.BRIDGE_TOKEN?.trim();

  if (envToken && provided === envToken) return { ok: true };

  let dbToken = "";
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "bridge_token"))
      .limit(1);
    dbToken = row?.value?.trim() ?? "";
  } catch {
    // If DB is down, we can only rely on env token.
  }

  if (dbToken && provided === dbToken) return { ok: true };

  // Dev mode: if no token exists anywhere, allow access so the sandbox/local
  // app works without configuration.
  if (!envToken && !dbToken) return { ok: true };

  return {
    ok: false,
    response: jsonResponse({ error: "unauthorized" }, 401),
  };
}
