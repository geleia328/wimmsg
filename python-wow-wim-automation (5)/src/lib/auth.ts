/**
 * Shared-secret guard used by all endpoints the Python bridge talks to.
 *
 * The bridge sends `Authorization: Bearer <BRIDGE_TOKEN>` and we compare with
 * the value in the env. If BRIDGE_TOKEN is not set (dev/demo mode) we allow
 * everything so the project boots without extra configuration.
 */
export function checkBridgeAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const expected = process.env.BRIDGE_TOKEN;
  if (!expected) return { ok: true };

  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();

  if (provided !== expected) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { ok: true };
}
