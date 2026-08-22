/**
 * Normalize Unicode to NFC form and fix common OCR/encoding misreads.
 *
 * WoW uses precomposed characters (NFC). OCR engines sometimes decompose
 * them (NFD) or substitute similar-looking glyphs:
 *   - ö (U+00F6) instead of ó (U+00F3)
 *   - ë instead of é, ü instead of ú, ï instead of í, ä instead of á
 */

const TREMA_TO_ACUTE: Record<string, string> = {
  "ö": "ó",
  "Ö": "Ó",
  "ë": "é",
  "Ë": "É",
  "ü": "ú",
  "Ü": "Ú",
  "ï": "í",
  "Ï": "Í",
  "ä": "á",
  "Ä": "Á",
};

const TREMA_RE = /[öÖëËüÜïÏäÄ]/g;

export function normalizePlayerName(name: string): string {
  let normalized = name.normalize("NFC");
  normalized = normalized.replace(TREMA_RE, (ch) => TREMA_TO_ACUTE[ch] ?? ch);
  return normalized;
}

/** Normalize a character or player name for storage (NFC + trema fix + lower). */
export function normalizeNameForStorage(name: string): string {
  return normalizePlayerName(name).trim().toLowerCase();
}
