/**
 * Normalize Unicode to NFC form and fix common OCR/encoding misreads.
 *
 * WoW uses precomposed characters (NFC). OCR engines sometimes decompose
 * them (NFD) or substitute similar-looking glyphs:
 *   - ö (U+00F6, o with diaeresis) instead of ó (U+00F3, o with acute)
 *   - ë instead of é
 *   - ü instead of ú
 *   - ï instead of í
 *   - ä instead of á
 *
 * WoW character names use NFC and never contain diaeresis (trema) for
 * Latin-based names. So if a player name contains ö/ë/ü/ï/ä we can
 * safely map them to the acute equivalents.
 *
 * This prevents "Aemönd-Area52" vs "Aemónd-Area52" split conversations.
 */

// Map trema → acute for common OCR misreads in WoW names
const TREMA_TO_ACUTE: Record<string, string> = {
  ö: "ó",
  Ö: "Ó",
  ë: "é",
  Ë: "É",
  ü: "ú",
  Ü: "Ú",
  ï: "í",
  Ï: "Í",
  ä: "á",
  Ä: "Á",
};

const TREMA_RE = /[öÖëËüÜïÏäÄ]/g;

export function normalizePlayerName(name: string): string {
  // Step 1: NFC normalization (combines decomposed chars)
  let normalized = name.normalize("NFC");

  // Step 2: Replace trema/diaeresis with acute for WoW names
  normalized = normalized.replace(
    TREMA_RE,
    (ch) => TREMA_TO_ACUTE[ch] ?? ch,
  );

  return normalized;
}

/**
 * Normalize a character or player name for storage.
 * Applies Unicode NFC + trema-to-acute fix + trim + lowercase.
 */
export function normalizeNameForStorage(name: string): string {
  return normalizePlayerName(name.trim()).toLowerCase();
}
