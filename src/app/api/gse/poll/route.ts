import { NextResponse } from "next/server";
import { db } from "@/db";
import { gseState } from "@/db/schema";
import { desc, gt, sql } from "drizzle-orm";
import { checkBridgeAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gse/poll?since=ISO
 *
 * Variante do /api/gse que retorna APENAS as configs que mudaram
 * desde `since` (ou todas se não for passado). O bridge chama isso
 * a cada 1.5s (configurável via queue_poll_ms no /api/control) e
 * só processa os itens que têm `updated_at > since`. Reduz tráfego
 * e mostra exatamente o que mudou.
 *
 * O `since` é o ISO timestamp da última leitura. Se vazio, retorna tudo.
 *
 * Resposta:
 *   { ok, serverTime, items: [{character, running, keybind, intervalMs, updatedAt}] }
 */
export async function GET(request: Request) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const sinceIso = new URL(request.url).searchParams.get("since");
  const since = sinceIso ? new Date(sinceIso) : null;

  let rows;
  if (since && !Number.isNaN(since.getTime())) {
    rows = await db
      .select()
      .from(gseState)
      .where(gt(gseState.updatedAt, since))
      .orderBy(desc(gseState.updatedAt))
      .limit(50);
  } else {
    rows = await db
      .select()
      .from(gseState)
      .orderBy(desc(gseState.updatedAt))
      .limit(50);
  }

  return NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    items: rows.map((r) => ({
      character: r.character,
      running: r.running === "yes",
      keybind: r.keybind,
      intervalMs: Number.parseInt(r.intervalMs, 10) || 100,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}
