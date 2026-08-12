import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, clientWindows, gseState, messages } from "@/db/schema";
import { checkAdminAuth } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  const [bridgeTokenRow] = await db
    .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(eq(appSettings.key, "bridge_token"))
    .limit(1);

  const [m] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages);
  const [w] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientWindows);
  const [g] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gseState);

  const dbUrl = process.env.DATABASE_URL ?? "";
  const envBridge = process.env.BRIDGE_TOKEN ?? "";

  return NextResponse.json({
    ok: true,
    database: {
      configured: Boolean(dbUrl),
      maskedUrl: mask(dbUrl),
      note:
        "DATABASE_URL não pode ser alterada pelo site. Edite nas Environment Variables da Vercel.",
    },
    bridgeToken: {
      envConfigured: Boolean(envBridge),
      envMasked: mask(envBridge),
      dynamicConfigured: Boolean(bridgeTokenRow?.value),
      dynamicMasked: mask(bridgeTokenRow?.value ?? ""),
      dynamicUpdatedAt: bridgeTokenRow?.updatedAt ?? null,
    },
    counts: {
      messages: m.count,
      windows: w.count,
      gseStates: g.count,
    },
  });
}

export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  let payload: { bridgeToken?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = (payload.bridgeToken ?? "").trim();
  if (token.length < 16) {
    return NextResponse.json(
      { error: "token must have at least 16 characters" },
      { status: 400 },
    );
  }

  await db
    .insert(appSettings)
    .values({ key: "bridge_token", value: token })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: token, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, masked: mask(token) });
}
