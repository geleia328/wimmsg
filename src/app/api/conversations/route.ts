import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, NewConversation } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const characterId = searchParams.get("characterId");
    const playerId = searchParams.get("playerId");

    let query = db.select().from(conversations);
    const allConvs = await query.orderBy(conversations.updatedAt);
    return NextResponse.json(allConvs);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch conversations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { characterId, playerId, title, bridgeToken } = body;

    if (!characterId || !playerId) {
      return NextResponse.json({ error: "characterId and playerId are required" }, { status: 400 });
    }

    const cId = parseInt(characterId, 10);
    const pId = parseInt(playerId, 10);

    const newConv: NewConversation = {
      characterId: cId,
      playerId: pId,
      title: title || "New Conversation",
      bridgeToken: bridgeToken || "",
    };

    const [inserted] = await db.insert(conversations).values(newConv).returning();
    return NextResponse.json(inserted, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create conversation" }, { status: 500 });
  }
}
