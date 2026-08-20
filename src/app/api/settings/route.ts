import { NextResponse } from "next/server";
import { db } from "@/db";
import { settings, NewSetting } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, string> = {};
    for (const s of allSettings) {
      settingsMap[s.key] = s.value;
    }
    return NextResponse.json(settingsMap);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key) {
      return NextResponse.json({ error: "Setting key is required" }, { status: 400 });
    }

    const [existing] = await db.select().from(settings).where(eq(settings.key, key));

    if (existing) {
      const [updated] = await db
        .update(settings)
        .set({ value: value ?? "", updatedAt: new Date() })
        .where(eq(settings.key, key))
        .returning();
      return NextResponse.json(updated);
    } else {
      const [inserted] = await db
        .insert(settings)
        .values({ key, value: value ?? "" })
        .returning();
      return NextResponse.json(inserted, { status: 201 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save setting" }, { status: 500 });
  }
}
