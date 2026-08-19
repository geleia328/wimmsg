import { db } from "@/db";
import { messages } from "@/db/schema";
import { randomId } from "@/lib/shared";
import { and, asc, eq, gt } from "drizzle-orm";

const realm = (name: string) => name.includes("-") ? name.slice(name.lastIndexOf("-") + 1).toLowerCase() : "";
export async function GET(request: Request, { params }: { params: Promise<{ character: string; player: string }> }) {
  const { character, player } = await params; const since = Number(new URL(request.url).searchParams.get("since") || 0);
  const filters = [eq(messages.character, character), eq(messages.player, player)]; if (since > 0) filters.push(gt(messages.id, since));
  const rows = await db.select().from(messages).where(and(...filters)).orderBy(asc(messages.createdAt), asc(messages.id)).limit(500);
  return Response.json({ messages: rows });
}
export async function POST(request: Request, { params }: { params: Promise<{ character: string; player: string }> }) {
  const { character, player } = await params; const data = await request.json().catch(() => ({})) as { body?: string }; const body = data.body?.trim() ?? "";
  if (!body || body.length > 255 || !character || !player) return Response.json({ error: "Mensagem deve ter entre 1 e 255 caracteres" }, { status: 400 });
  const inserted = await db.insert(messages).values({ character: character.slice(0,128), player: player.slice(0,128), body, direction: "outgoing", status: "pending", externalId: randomId("out") }).returning();
  const cr = realm(character), pr = realm(player); const warning = cr && pr && cr !== pr ? `Atenção: ${character} e ${player} parecem estar em reinos diferentes.` : undefined;
  return Response.json({ message: inserted[0], warning });
}
