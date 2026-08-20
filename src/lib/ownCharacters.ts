import { db } from "@/db";
import { clientWindows, gseState, messages } from "@/db/schema";

export async function getKnownOwnCharacters(): Promise<Set<string>> {
  const known = new Set<string>();
  const [windows, gse, chars] = await Promise.all([
    db.select({ character: clientWindows.character }).from(clientWindows),
    db.select({ character: gseState.character }).from(gseState),
    db.selectDistinct({ character: messages.character }).from(messages),
  ]);
  for (const row of [...windows, ...gse, ...chars]) {
    const name = row.character.trim();
    if (name) known.add(name.toLowerCase());
  }
  return known;
}
