import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Updates DATABASE_URL on Vercel via the REST API. Requires both
 * VERCEL_TOKEN and VERCEL_PROJECT_ID env vars to be configured on the host.
 * In sandboxes/local these are absent, so we return a clear instruction
 * instead of failing the deploy.
 */
export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    return NextResponse.json(
      {
        ok: false,
        reason: "missing_env",
        message:
          "Define VERCEL_TOKEN e VERCEL_PROJECT_ID no ambiente para atualizar a DATABASE_URL automaticamente. Sem eles, atualize a variável direto no painel da Vercel.",
      },
      { status: 400 },
    );
  }

  let payload: { databaseUrl?: string; target?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload.databaseUrl) {
    return NextResponse.json({ error: "missing_database_url" }, { status: 400 });
  }

  const target = payload.target ?? "production";
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/env`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key: "DATABASE_URL",
        value: payload.databaseUrl,
        type: "encrypted",
        target: [target],
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { ok: false, status: res.status, detail: text },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
