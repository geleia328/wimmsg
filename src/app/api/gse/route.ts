import { NextResponse } from "next/server";
import { db } from "@/db";
import { gseGlobalSettings, gseCharacters } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    let [globalSettings] = await db.select().from(gseGlobalSettings);
    if (!globalSettings) {
      const [inserted] = await db
        .insert(gseGlobalSettings)
        .values({
          leitorWindowsActive: false,
          masterGseActive: true,
          pressEscAfterSend: false,
          delayEnter: 500,
          delayBeforeSpace: 500,
          delaySpaceWhisper: 500,
          delayFocusWindow: 500,
          delayBetweenKeys: 500,
          delaySendMsg: 500,
          delayAfterWhisper: 500,
          delayPollQueue: 500,
        })
        .returning();
      globalSettings = inserted;
    }

    const charactersList = await db.select().from(gseCharacters).orderBy(gseCharacters.id);

    return NextResponse.json({
      global: globalSettings,
      characters: charactersList,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch GSE state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, data } = body;

    if (type === "global") {
      let [existing] = await db.select().from(gseGlobalSettings);
      if (existing) {
        const [updated] = await db
          .update(gseGlobalSettings)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(gseGlobalSettings.id, existing.id))
          .returning();
        return NextResponse.json(updated);
      } else {
        const [inserted] = await db.insert(gseGlobalSettings).values(data).returning();
        return NextResponse.json(inserted);
      }
    } else if (type === "toggle_all") {
      const { isRodando } = data;
      await db.update(gseCharacters).set({ isRodando });
      const charactersList = await db.select().from(gseCharacters);
      return NextResponse.json({ success: true, characters: charactersList });
    } else if (type === "toggle_character") {
      const { id, isRodando } = data;
      const [updated] = await db
        .update(gseCharacters)
        .set({ isRodando })
        .where(eq(gseCharacters.id, id))
        .returning();
      return NextResponse.json(updated);
    } else if (type === "update_character") {
      const { id, keyGse, intervalMs, slot, status, name } = data;
      const [updated] = await db
        .update(gseCharacters)
        .set({
          ...(keyGse !== undefined ? { keyGse } : {}),
          ...(intervalMs !== undefined ? { intervalMs } : {}),
          ...(slot !== undefined ? { slot } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(name !== undefined ? { name } : {}),
        })
        .where(eq(gseCharacters.id, id))
        .returning();
      return NextResponse.json(updated);
    } else if (type === "add_character") {
      const { name = "Hero-Realm", slot = "wow0", keyGse = "F5", intervalMs = 2000 } = data || {};
      const [inserted] = await db
        .insert(gseCharacters)
        .values({
          name,
          slot,
          keyGse,
          intervalMs,
          isRodando: true,
          status: "online",
        })
        .returning();
      return NextResponse.json(inserted);
    } else if (type === "delete_character") {
      const { id } = data;
      await db.delete(gseCharacters).where(eq(gseCharacters.id, id));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action type" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update GSE state" }, { status: 500 });
  }
}
