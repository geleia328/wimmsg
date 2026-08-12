import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  vercelToken?: string;
  projectIdOrName?: string;
  teamId?: string;
  databaseUrl?: string;
  bridgeToken?: string;
  deployHookUrl?: string;
};

function validDatabaseUrl(url: string) {
  return (
    url.startsWith("postgresql://") &&
    url.includes("@") &&
    url.includes("/") &&
    url.includes("sslmode=require")
  );
}

async function upsertEnv({
  vercelToken,
  projectIdOrName,
  teamId,
  key,
  value,
}: {
  vercelToken: string;
  projectIdOrName: string;
  teamId?: string;
  key: string;
  value: string;
}) {
  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(projectIdOrName)}/env`,
  );
  url.searchParams.set("upsert", "true");
  if (teamId) url.searchParams.set("teamId", teamId);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${vercelToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      {
        key,
        value,
        type: "sensitive",
        target: ["production"],
        comment: `Updated from Bakers Whisper settings at ${new Date().toISOString()}`,
      },
    ]),
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text
  }

  if (!response.ok) {
    throw new Error(
      `Vercel env ${key} failed (${response.status}): ${JSON.stringify(data)}`,
    );
  }
  return data;
}

/**
 * Updates Vercel production environment variables from the admin settings UI.
 * This endpoint intentionally does not touch the database, so it still works
 * when DATABASE_URL is broken and the app cannot query Neon yet.
 */
export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  let payload: Payload = {};
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const vercelToken = (payload.vercelToken ?? "").trim();
  const projectIdOrName = (payload.projectIdOrName ?? "").trim();
  const teamId = (payload.teamId ?? "").trim() || undefined;
  const databaseUrl = (payload.databaseUrl ?? "").trim();
  const bridgeToken = (payload.bridgeToken ?? "").trim();
  const deployHookUrl = (payload.deployHookUrl ?? "").trim();

  if (!vercelToken) {
    return NextResponse.json({ error: "vercelToken required" }, { status: 400 });
  }
  if (!projectIdOrName) {
    return NextResponse.json(
      { error: "projectIdOrName required" },
      { status: 400 },
    );
  }
  if (!databaseUrl && !bridgeToken) {
    return NextResponse.json(
      { error: "databaseUrl or bridgeToken required" },
      { status: 400 },
    );
  }
  if (databaseUrl && !validDatabaseUrl(databaseUrl)) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL inválida. Use a Pooled connection string do Neon com postgresql:// e sslmode=require.",
      },
      { status: 400 },
    );
  }
  if (bridgeToken && bridgeToken.length < 16) {
    return NextResponse.json(
      { error: "BRIDGE_TOKEN precisa ter pelo menos 16 caracteres" },
      { status: 400 },
    );
  }

  const updated: string[] = [];
  const results: Record<string, unknown> = {};

  try {
    if (databaseUrl) {
      results.DATABASE_URL = await upsertEnv({
        vercelToken,
        projectIdOrName,
        teamId,
        key: "DATABASE_URL",
        value: databaseUrl,
      });
      updated.push("DATABASE_URL");
    }

    if (bridgeToken) {
      results.BRIDGE_TOKEN = await upsertEnv({
        vercelToken,
        projectIdOrName,
        teamId,
        key: "BRIDGE_TOKEN",
        value: bridgeToken,
      });
      updated.push("BRIDGE_TOKEN");
    }

    let deployHookTriggered = false;
    let deployHookResponse: unknown = null;
    if (deployHookUrl) {
      const hookResponse = await fetch(deployHookUrl, { method: "POST" });
      const text = await hookResponse.text();
      deployHookTriggered = hookResponse.ok;
      try {
        deployHookResponse = JSON.parse(text);
      } catch {
        deployHookResponse = text;
      }
      if (!hookResponse.ok) {
        return NextResponse.json(
          {
            ok: false,
            updated,
            error: `Env vars atualizadas, mas Deploy Hook falhou (${hookResponse.status})`,
            deployHookResponse,
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      updated,
      results,
      deployHookTriggered,
      deployHookResponse,
      nextStep: deployHookTriggered
        ? "Aguarde o redeploy terminar na Vercel."
        : "Agora vá na Vercel > Deployments > Redeploy para aplicar as variáveis.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        updated,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
