import { NextResponse } from "next/server";
import { db } from "@/db";
import { characters } from "@/db/schema";
import { eq } from "drizzle-orm";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const charId = parseInt(id, 10);
    if (isNaN(charId)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const [char] = await db.select().from(characters).where(eq(characters.id, charId));
    if (!char) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json(char);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch character" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const charId = parseInt(id, 10);
    if (isNaN(charId)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const body = await request.json();
    const { name, avatarUrl, description, greeting, personality, systemPrompt } = body;

    const [updated] = await db
      .update(characters)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(greeting !== undefined ? { greeting } : {}),
        ...(personality !== undefined ? { personality } : {}),
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(characters.id, charId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update character" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const charId = parseInt(id, 10);
    if (isNaN(charId)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const [deleted] = await db.delete(characters).where(eq(characters.id, charId)).returning();
    if (!deleted) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete character" }, { status: 500 });
  }
}
