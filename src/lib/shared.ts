export function maskSecret(value?: string | null) {
  if (!value) return "não configurado";
  if (value.length < 8) return "***";
  return value.slice(0, 4) + "…" + value.slice(-4);
}

export function formatDbError(error: unknown) {
  const e = error as Record<string, unknown> | null;
  const cause = e?.cause as Record<string, unknown> | undefined;
  return {
    name: String(e?.name ?? "Error"),
    message: String(e?.message ?? error),
    code: e?.code,
    detail: e?.detail,
    hint: e?.hint,
    cause: cause
      ? {
          name: cause.name,
          message: cause.message,
          code: cause.code,
          errno: cause.errno,
          syscall: cause.syscall,
          hostname: cause.hostname,
        }
      : undefined,
  };
}

export function randomId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID()}`.slice(
    0,
    128,
  );
}

/** Nomes de canal / sistema que nunca são um personagem de verdade. */
export const NOISE_NAMES = [
  "unknown",
  "guild",
  "party",
  "raid",
  "system",
  "wim",
  "general",
  "comercio",
  "trade",
];

export function isLikelyPlayerName(player: string): boolean {
  const p = player.trim().toLowerCase();
  if (p.length < 2 || p.length > 64) return false;
  if (!/[a-zà-ÿ]/i.test(p)) return false;
  if (/^\d+$/.test(p)) return false;
  return !NOISE_NAMES.includes(p);
}

/** Corpo de mensagem que veio de OCR de UI, não de um sussurro real. */
export function isLikelyPollutedBody(body: string): boolean {
  return /\b(no do canal|intervalo|flood\s*&\s*queue|status:\s*desligado|criar link|exportar perfil|importar perfil|ligar sistema|todos os objetivos|missões|recompensas|comércio\s*-\s*cidade|guilda ativa|recruta dps|lf craft)\b/i.test(
    body,
  );
}
