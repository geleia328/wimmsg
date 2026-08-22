import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientWindows, messages } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { normalizeNameForStorage } from "@/lib/unicode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Simulador de bridge.
 *
 * O projeto real depende do `wim_bridge.py` rodando no PC do jogador para
 * ler o WoWChatLog.txt e digitar as respostas. Aqui no preview não existe
 * WoW nenhum, então esta rota faz o papel da ponte: registra janelas falsas,
 * injeta sussurros de exemplo e "entrega" as respostas pendentes da fila.
 */

const CHARS = [
  { character: "bakerz", realm: "Area52", slot: "1" },
  { character: "aemónd", realm: "Azralon", slot: "2" },
  { character: "goldin", realm: "Nemesis", slot: "3" },
  { character: "sussurro", realm: "Azralon", slot: "4" },
];

const PLAYERS: Record<string, string[]> = {
  "bakerz-area52": ["thrallmar-area52", "vendinha-area52", "lurkin-area52"],
  "aemónd-azralon": ["bruxinha-azralon", "comprador-azralon", "guildbank-azralon"],
  "goldin-nemesis": ["ferreiro-nemesis", "duvidoso-nemesis"],
  "sussurro-azralon": ["bruxinha-azralon", "aleatorio-azralon"],
};

const BODIES = [
  "oi, ainda tem pão de abóbora?",
  "compro 20 unidades, pago 500g cada",
  "qual o preço do festim generoso?",
  "obrigado pela entrega rápida!",
  "vc crafta armadura de titânio?",
  "tem desconto pra quantidade?",
  "oi! vi seu anúncio na cidade",
  "aceita troca por materiais?",
  "boa noite, ainda tá on?",
  "quanto fica o pacote completo?",
  "mandei o convite de grupo",
  "valeu, até mais!",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function registerWindows() {
  for (const c of CHARS) {
    const hwnd = `sim-${c.character}`;
    const values = {
      character: normalizeNameForStorage(`${c.character}-${c.realm}`),
      windowTitle: `World of Warcraft — ${c.character} (${c.realm})`,
      pid: String(1000 + Number(c.slot) * 37),
      hwnd,
      foreground: c.slot === "1" ? ("yes" as const) : ("no" as const),
      matched: "yes" as const,
      slot: c.slot,
      realm: c.realm,
      lastSeen: new Date(),
    };
    await db
      .insert(clientWindows)
      .values(values)
      .onConflictDoUpdate({ target: clientWindows.hwnd, set: values });
  }
}

async function countMessages() {
  const rows = await db
    .select({ character: messages.character, player: messages.player })
    .from(messages)
    .limit(1);
  return rows.length;
}

async function seed() {
  await registerWindows();

  const existing = await countMessages();
  if (existing > 0) {
    return { seeded: 0, skipped: "já existe histórico" };
  }

  const now = Date.now();
  const values = [];
  let n = 0;
  for (const [character, players] of Object.entries(PLAYERS)) {
    for (const player of players) {
      const rounds = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < rounds; i += 1) {
        n += 1;
        values.push({
          character,
          player,
          direction: "incoming" as const,
          status: "sent" as const,
          body: pick(BODIES),
          externalId: `seed-${character}-${player}-${i}`,
          createdAt: new Date(now - (60 - n) * 90_000),
        });
        if (i % 2 === 1) {
          n += 1;
          values.push({
            character,
            player,
            direction: "outgoing" as const,
            status: "sent" as const,
            body: "opa, tenho sim! te encontro na cidade",
            externalId: `seed-out-${character}-${player}-${i}`,
            createdAt: new Date(now - (60 - n) * 90_000),
            sentAt: new Date(now - (60 - n) * 90_000),
          });
        }
      }
    }
  }

  await db
    .insert(messages)
    .values(values)
    .onConflictDoNothing({ target: messages.externalId });

  return { seeded: values.length };
}

async function incoming() {
  await registerWindows();
  const character = pick(CHARS.map((c) => `${c.character}-${c.realm}`)).toLowerCase();
  const players = PLAYERS[character] ?? PLAYERS["bakerz-area52"];
  const player = pick(players);
  const [inserted] = await db
    .insert(messages)
    .values({
      character,
      player,
      direction: "incoming",
      status: "sent",
      body: pick(BODIES),
      externalId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  // Atualiza o lastSeen da janela correspondente (simula o que o
  // bridge real faz no /api/status/scan ao detectar um whisper).
  const charMeta = CHARS.find((c) => `${c.character}-${c.realm}`.toLowerCase() === character);
  if (charMeta) {
    await db
      .update(clientWindows)
      .set({ lastSeen: new Date(), foreground: "yes" })
      .where(eq(clientWindows.hwnd, `sim-${charMeta.character}`));
  }
  return { message: inserted };
}

/** Faz o papel do bridge: pega a fila pendente e confirma o envio. */
async function deliver() {
  await registerWindows();
  const pending = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(eq(messages.direction, "outgoing"), eq(messages.status, "pending")),
    )
    .orderBy(asc(messages.createdAt))
    .limit(20);

  let delivered = 0;
  for (const p of pending) {
    await db
      .update(messages)
      .set({ status: "sent", error: null, sentAt: new Date() })
      .where(eq(messages.id, p.id));
    delivered += 1;
  }

  return { delivered, checked: pending.length };
}

export async function POST(request: NextRequest) {
  let payload: { action?: string } = {};
  try {
    payload = (await request.json()) as { action?: string };
  } catch {
    payload = {};
  }

  switch (payload.action) {
    case "seed":
      return NextResponse.json({ ok: true, ...(await seed()) });
    case "incoming":
      return NextResponse.json({ ok: true, ...(await incoming()) });
    case "deliver":
      return NextResponse.json({ ok: true, ...(await deliver()) });
    case "tick": {
      const d = await deliver();
      const shouldWhisper = Math.random() < 0.35;
      const inc = shouldWhisper ? await incoming() : null;
      return NextResponse.json({ ok: true, ...d, incoming: inc?.message ?? null });
    }
    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}

export async function GET() {
  const windows = await db
    .select({ id: clientWindows.id })
    .from(clientWindows)
    .limit(1);
  return NextResponse.json({ ok: true, hasWindows: windows.length > 0 });
}
