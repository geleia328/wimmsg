import type { NextRequest } from "next/server";

function getToken(req: Request | NextRequest): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (h) {
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
    return h.trim();
  }
  const alt = req.headers.get("x-bridge-token") || req.headers.get("X-Bridge-Token");
  if (alt) return alt.trim();
  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  if (q) return q.trim();
  return null;
}

/**
 * Check if request has a valid bridge token.
 * If BRIDGE_TOKEN is not set (dev), always allow.
 */
export function checkBridgeAuth(req: Request | NextRequest): boolean {
  const expected = process.env.BRIDGE_TOKEN;
  if (!expected || expected.length === 0) return true;
  const got = getToken(req);
  return got === expected;
}

/**
 * Check if request has a valid admin token.
 * Uses ADMIN_TOKEN if set, otherwise BRIDGE_TOKEN.
 * If neither set (dev), always allow.
 */
export function checkAdminAuth(req: Request | NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN || process.env.BRIDGE_TOKEN;
  if (!expected || expected.length === 0) return true;
  const got = getToken(req);
  return got === expected;
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/**
 * Case-insensitive name comparison.
 */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Parse defensive body containing WIMBRIDGE/WIMRELAY markers, returning
 * corrected fields when relay/marker syntax is present, or null otherwise.
 */
export type ParsedRelay = {
  character: string;
  player: string;
  body: string;
  direction: "incoming" | "outgoing";
};

export function parseRelayBody(
  rawCharacter: string,
  rawPlayer: string,
  rawBody: string,
): ParsedRelay | null {
  if (!rawBody) return null;
  const body = rawBody.trim();

  // WIMRELAY<OWN:...><FROM:...><TS:...>msg
  // WIMRELAY<OWN:...><TO:...><TS:...>msg
  let m = body.match(/^\[?WIMRELAY\]?<OWN:([^>]+)><(FROM|TO):([^>]+)>(?:<TS:[^>]*>)?(.*)$/i);
  if (m) {
    const own = m[1].trim();
    const kind = m[2].toUpperCase();
    const other = m[3].trim();
    const payload = m[4].trim();
    return {
      character: own,
      player: other,
      body: payload,
      direction: kind === "FROM" ? "incoming" : "outgoing",
    };
  }

  // [WIMBRIDGE]<OWN:...><FROM:...>msg
  m = body.match(/^\[?WIMBRIDGE\]?<OWN:([^>]+)><(FROM|TO):([^>]+)>(.*)$/i);
  if (m) {
    const own = m[1].trim();
    const kind = m[2].toUpperCase();
    const other = m[3].trim();
    const payload = m[4].trim();
    return {
      character: own,
      player: other,
      body: payload,
      direction: kind === "FROM" ? "incoming" : "outgoing",
    };
  }

  return null;
}
