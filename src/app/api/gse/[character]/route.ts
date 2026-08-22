import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gseState } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { canonicalName } from "@/lib/realm";
import { checkBridgeAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * POST /api/gse/[character]
 *   { keybind?: string, intervalMs?: number, running?: boolean }
 *
 *   - Se vier `running:true`, define running=yes.
 *   - Se vier `running:false`, define running=no.
 *   - Se vier `keybind` ou `intervalMs`, atualiza esses campos.
 *
 * O bridge faz polling nesta rota a cada 1.5s (queue_poll_ms) e:
 *   - Lê a config salva
 *   - Se running=yes e a janela do personagem está aberta, ele
 *     pressiona a tecla em loop no intervalo configurado.
 *   - Atualiza o `updated_at` para o painel saber que o bridge
 *     continua "vivo" naquela conta.
 *
 * Se o nome do personagem for inválido (com dígito, OCR zoado), 400.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ character: string }> },
) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;
  const { character: rawChar } = await context.params;
  const character = canonicalName(decodeURIComponent(rawChar));
  if (!character) {
    return NextResponse.json(
      { error: `personagem inválido: "${rawChar}"` },
      { status: 400 },
    );
  }

  let payload: { keybind?: string; intervalMs?: number; running?: boolean } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    payload = {};
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof payload.keybind === "string") {
    const k = payload.keybind.trim();
    if (k.length === 0 || k.length > 32) {
      return NextResponse.json(
        { error: "keybind deve ter entre 1 e 32 caracteres" },
        { status: 400 },
      );
    }
    update.keybind = k;
  }
  if (typeof payload.intervalMs === "number") {
    const n = Math.max(20, Math.min(10_000, Math.floor(payload.intervalMs)));
    update.intervalMs = String(n);
  }
  if (typeof payload.running === "boolean") {
    update.running = payload.running ? "yes" : "no";
  }

  await db
    .insert(gseState)
    .values({
      character,
      keybind: (update.keybind as string) ?? "1",
      intervalMs: (update.intervalMs as string) ?? "100",
      running: (update.running as string) ?? "no",
    })
    .onConflictDoUpdate({
      target: gseState.character,
      set: update,
    });

  const [row] = await db
    .select()
    .from(gseState)
    .where(eq(gseState.character, character))
    .limit(1);

  return NextResponse.json({ ok: true, gse: row });
}

/** Remove apenas a configuração GSE. A janela/conversa continua intacta. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ character: string }> },
) {
  const guard = await checkBridgeAuth(request);
  if (!guard.ok) return guard.response;

  const { character: rawChar } = await context.params;
  const character = canonicalName(decodeURIComponent(rawChar));
  if (!character) {
    return NextResponse.json({ error: "personagem inválido" }, { status: 400 });
  }
  await db.delete(gseState).where(sql`lower(${gseState.character}) = ${character}`);
  return NextResponse.json({ ok: true, character });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ character: string }> },
) {
  const { character: rawChar } = await context.params;
  const character = canonicalName(decodeURIComponent(rawChar));
  if (!character) {
    return NextResponse.json({ error: "personagem inválido" }, { status: 400 });
  }
  const [row] = await db
    .select()
    .from(gseState)
    .where(eq(gseState.character, character))
    .limit(1);
  return NextResponse.json({
    ok: true,
    character,
    gse: row ?? {
      character,
      running: "no",
      keybind: "1",
      intervalMs: "100",
      updatedAt: null,
    },
  });
}
