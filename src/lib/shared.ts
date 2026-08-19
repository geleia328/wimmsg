export function maskSecret(value?: string | null) {
  if (!value) return "não configurado";
  if (value.length <= 10) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

export function errorDetails(error: unknown) {
  const e = error as Record<string, unknown> | null;
  const cause = e?.cause as Record<string, unknown> | undefined;
  return {
    name: String(e?.name ?? "Error"), message: String(e?.message ?? error),
    code: e?.code, detail: e?.detail, hint: e?.hint,
    cause: cause ? { name: cause.name, message: cause.message, code: cause.code, errno: cause.errno, syscall: cause.syscall, hostname: cause.hostname } : undefined,
  };
}

export function randomId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID()}`.slice(0, 128);
}
