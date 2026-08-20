import { NextResponse } from "next/server";
import { db } from "@/db";
import { players, NewPlayer } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const allPlayers = await db.select().from(players).orderBy(players.id);
    return NextResponse.json(allPlayers);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch players" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, displayName, avatarUrl } = body;

    if (!username || !displayName) {
      return NextResponse.json({ error: "Username and displayName are required" }, { status: 400 });
    }

    const newPlayer: NewPlayer = {
      username,
      displayName,
      avatarUrl: avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&auto=format&fit=crop&q=80",
    };

    const [inserted] = await db.insert(players).values(newPlayer).returning();
    return NextResponse.json(inserted, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create player" }, { status: 500 });
  }
}
