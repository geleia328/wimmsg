import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, DEFAULT_ADMIN_SETTINGS } from "@/db/schema";
import { checkAdminAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  let dbToken = "";
  let timeout: string = DEFAULT_ADMIN_SETTINGS.pending_timeout_minutes;
  let dbOk = false;
  try {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings);
    dbOk = true;
    for (const r of rows) {
      if (r.key === "bridge_token") dbToken = r.value;
      if (r.key === "pending_timeout_minutes") timeout = r.value;
    }
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    ok: true,
    dbOnline: dbOk,
    envBridgeToken: Boolean(process.env.BRIDGE_TOKEN),
    envAdminToken: Boolean(process.env.ADMIN_TOKEN),
    dbBridgeTokenSet: dbToken.trim().length > 0,
    pendingTimeoutMinutes: Number(timeout) || 0,
  });
}

export async function POST(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  let payload: {
    bridgeToken?: string;
    pendingTimeoutMinutes?: number;
  } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof payload.bridgeToken === "string") {
    const token = payload.bridgeToken.trim();
    await db
      .insert(appSettings)
      .values({ key: "bridge_token", value: token })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: token, updatedAt: new Date() },
      });
  }

  if (typeof payload.pendingTimeoutMinutes === "number") {
    const minutes = String(
      Math.max(0, Math.min(1440, Math.floor(payload.pendingTimeoutMinutes))),
    );
    await db
      .insert(appSettings)
      .values({ key: "pending_timeout_minutes", value: minutes })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: minutes, updatedAt: new Date() },
      });
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(request: NextRequest) {
  const guard = checkAdminAuth(request);
  if (!guard.ok) return guard.response;

  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await db
    .insert(appSettings)
    .values({ key: "bridge_token", value: token })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: token, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, bridgeToken: token });
}
