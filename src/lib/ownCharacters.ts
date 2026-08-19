import { db } from "@/db";
import { clientWindows, gseState, messages } from "@/db/schema";

/**
 * Returns the characters currently known to belong to the user's WoW setup.
 *
 * A window can briefly report matched=no while the bridge is rescanning, so
 * character presence is intentionally enough — filtering only matched=yes
 * caused self-character messages to stay on the sender side.
 */
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
