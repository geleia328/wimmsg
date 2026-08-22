/**
 * Saneamento de nomes de realm para evitar os bugs reportados:
 *  - "Illidan" vs "illidan" (case) → comparar normalizado
 *  - "bleedinghollow" vs "bleedingh0110w" (OCR 'o'→'0', 'l'→'1') → bloquear
 *  - realm com dígitos no nome → rejeitar
 *
 * O "shape" do nome WoW é estritamente alfabético, então qualquer dígito
 * que apareça é um erro do OCR — não do servidor.
 */

const NOISE_NAMES = new Set([
  "unknown",
  "guild",
  "party",
  "raid",
  "system",
  "wim",
  "general",
  "comercio",
  "trade",
]);

/** Mapa de "OCR confundiu" usado em correções pontuais. */
const OCR_CHAR_FIXES: Record<string, string> = {
  "0": "o",
  "1": "l",
  "5": "s",
};

function fixOcrChar(ch: string): string {
  return OCR_CHAR_FIXES[ch] ?? ch;
}

function isAlphaOnly(value: string): boolean {
  return /^[A-Za-zÀ-ÿ'\-]+$/.test(value);
}

/**
 * Segmento do REALM pode ter letras E dígitos (ex: Area52, Kazzak).
 * O NOME do personagem é estritamente alfabético.
 * O bug "bleedingh0110w" era o OCR trocando 'o' por '0' e 'l' por '1'
 * DENTRO de uma palavra alfabética — não na palavra "Area52" onde o 52
 * é o número real do realm.
 *
 * Heurística anti-OCR usada aqui: se o segmento do realm contém 3+
 * dígitos consecutivos, é quase certeza erro de OCR (ninguém tem
 * realm "bleedingh0110w" no WoW). Rejeita nesse caso.
 */
function isLikelyOcrNameCorruption(value: string): boolean {
  return /\d{3,}/.test(value);
}

/**
 * Valida e normaliza um "Personagem-Realm" ou apenas "Personagem".
 * Devolve a forma canônica (lowercase) ou null se inválido.
 */
export function canonicalName(input: string): string | null {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;
  // Colapsa espaços em torno do hífen.
  value = value.replace(/\s*-\s*/g, "-");

  const parts = value.split("-");
  if (parts.length === 0) return null;

  // Nome do personagem (1º segmento) é estritamente alfabético.
  // Realm (segmentos seguintes) pode ter letras e dígitos, MAS não
  // pode ter 3+ dígitos consecutivos (que seria OCR zoado tipo
  // "bleedingh0110w").
  if (!isAlphaOnly(parts[0])) return null;
  if (parts[0].length < 2 || parts[0].length > 24) return null;
  for (let i = 1; i < parts.length; i += 1) {
    const p = parts[i];
    if (!p) return null;
    if (p.length < 2 || p.length > 24) return null;
    if (!/^[A-Za-zÀ-ÿ0-9'\-]+$/.test(p)) return null;
    if (isLikelyOcrNameCorruption(p)) return null;
  }

  const name = parts[0].toLowerCase();
  if (NOISE_NAMES.has(name)) return null;
  if (parts.length === 1) return name;
  return `${name}-${parts.slice(1).join("-").toLowerCase()}`;
}

export function realmOf(value: string): string {
  if (!value) return "";
  const idx = value.lastIndexOf("-");
  if (idx < 0) return "";
  return value.slice(idx + 1);
}

export function nameWithoutRealm(value: string): string {
  if (!value) return "";
  const idx = value.lastIndexOf("-");
  if (idx < 0) return value;
  return value.slice(0, idx);
}

/** Compara dois nomes ignorando case. */
export function sameName(a: string, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Tenta corrigir um nome OCR-zoado. Retorna null se não der. */
export function tryFixOcrName(input: string): string | null {
  if (!input) return null;
  const replaced = input
    .replace(/[^A-Za-zÀ-ÿ0-9'\-]/g, "")
    .replace(/0/g, fixOcrChar)
    .replace(/1/g, fixOcrChar)
    .replace(/5/g, fixOcrChar);
  return canonicalName(replaced);
}
