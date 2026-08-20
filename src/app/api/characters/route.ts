import { NextResponse } from "next/server";
import { db } from "@/db";
import { characters, NewCharacter } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const allCharacters = await db.select().from(characters).orderBy(characters.id);
    return NextResponse.json(allCharacters);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch characters" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, avatarUrl, description, greeting, personality, systemPrompt } = body;

    if (!name) {
      return NextResponse.json({ error: "Character name is required" }, { status: 400 });
    }

    const newChar: NewCharacter = {
      name,
      avatarUrl: avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80",
      description: description || "",
      greeting: greeting || "Hello! Ready for our chat?",
      personality: personality || "",
      systemPrompt: systemPrompt || "",
    };

    const [inserted] = await db.insert(characters).values(newChar).returning();
    return NextResponse.json(inserted, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create character" }, { status: 500 });
  }
}
