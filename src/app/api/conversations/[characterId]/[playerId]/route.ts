import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, characters, players, NewMessage } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

interface RouteParams {
  params: Promise<{ characterId: string; playerId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { characterId, playerId } = await params;
    const cId = parseInt(characterId, 10);
    const pId = parseInt(playerId, 10);

    if (isNaN(cId) || isNaN(pId)) {
      return NextResponse.json({ error: "Invalid characterId or playerId" }, { status: 400 });
    }

    // Find or create conversation for this character + player
    let [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.characterId, cId), eq(conversations.playerId, pId)));

    if (!conv) {
      // Get character and player names for default title
      const [char] = await db.select().from(characters).where(eq(characters.id, cId));
      const [player] = await db.select().from(players).where(eq(players.id, pId));
      const title = `${char?.name || "Character"} & ${player?.displayName || "Player"}`;

      const [newConv] = await db
        .insert(conversations)
        .values({
          characterId: cId,
          playerId: pId,
          title,
          bridgeToken: "",
        })
        .returning();
      conv = newConv;

      // Also create initial greeting message if character has a greeting
      if (char?.greeting) {
        await db.insert(messages).values({
          conversationId: conv.id,
          senderType: "character",
          content: char.greeting,
        });
      }
    }

    const convMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json({
      conversation: conv,
      messages: convMessages,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch conversation messages" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { characterId, playerId } = await params;
    const cId = parseInt(characterId, 10);
    const pId = parseInt(playerId, 10);

    if (isNaN(cId) || isNaN(pId)) {
      return NextResponse.json({ error: "Invalid characterId or playerId" }, { status: 400 });
    }

    const body = await request.json();
    const { content, senderType = "player", generateReply = true } = body;

    if (!content) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }

    // Find conversation
    let [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.characterId, cId), eq(conversations.playerId, pId)));

    if (!conv) {
      const [char] = await db.select().from(characters).where(eq(characters.id, cId));
      const [player] = await db.select().from(players).where(eq(players.id, pId));
      const title = `${char?.name || "Character"} & ${player?.displayName || "Player"}`;

      const [newConv] = await db
        .insert(conversations)
        .values({
          characterId: cId,
          playerId: pId,
          title,
          bridgeToken: "",
        })
        .returning();
      conv = newConv;
    }

    // Insert player (or sender) message
    const [userMsg] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        senderType,
        content,
      })
      .returning();

    let characterReplyMsg = null;

    if (senderType === "player" && generateReply) {
      const [char] = await db.select().from(characters).where(eq(characters.id, cId));
      const charName = char?.name || "Character";
      const personality = char?.personality || "friendly and helpful";

      // Intelligent simulated roleplay response or bridge token response
      const replyTexts = [
        `*${charName} smiles gently* That's fascinating! Tell me more about your thoughts on this.`,
        `I understand completely. As someone focused on ${personality}, I feel we can achieve great things together.`,
        `*${charName} nods thoughtfully* Indeed. Let us explore that angle further.`,
        `That's a remarkable point! How would you like to proceed next?`,
      ];
      const randomReply = replyTexts[Math.floor(Math.random() * replyTexts.length)];

      const [replyMsg] = await db
        .insert(messages)
        .values({
          conversationId: conv.id,
          senderType: "character",
          content: randomReply,
        })
        .returning();
      characterReplyMsg = replyMsg;
    }

    // Update conversation updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conv.id));

    return NextResponse.json({
      message: userMsg,
      reply: characterReplyMsg,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to send message" }, { status: 500 });
  }
}
