import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    databaseUrl: process.env.DATABASE_URL ?? "NOT SET",
    bridgeToken: process.env.BRIDGE_TOKEN ? "SET" : "NOT SET",
  });
}
