import { db } from "@/db";
import { messages, clientWindows, gseState } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorToDebug(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const maybe = error as Error & {
    code?: string;
    detail?: string;
    hint?: string;
    cause?: unknown;
  };

  const cause = maybe.cause;
  let causeDebug: unknown = undefined;
  if (cause instanceof Error) {
    const c = cause as Error & {
      code?: string;
      errno?: string;
      syscall?: string;
      hostname?: string;
      detail?: string;
    };
    causeDebug = {
      name: c.name,
      message: c.message,
      code: c.code,
      errno: c.errno,
      syscall: c.syscall,
      hostname: c.hostname,
      detail: c.detail,
    };
  } else if (cause) {
    causeDebug = String(cause);
  }

  return {
    name: error.name,
    message: error.message,
    code: maybe.code,
    detail: maybe.detail,
    hint: maybe.hint,
    cause: causeDebug,
  };
}

function maskDatabaseUrl(url: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const user = parsed.username ? `${parsed.username}:***@` : "";
    return `${parsed.protocol}//${user}${parsed.hostname}${parsed.pathname}${parsed.search ? "?" + parsed.searchParams.toString() : ""}`;
  } catch {
    return url.length > 16 ? `${url.slice(0, 8)}••••${url.slice(-8)}` : "••••";
  }
}

/**
 * Public health endpoint used by Vercel and BakersWhisper.exe.
 * It does not require BRIDGE_TOKEN. It intentionally returns a detailed DB
 * error to make setup issues in Vercel/Neon easy to diagnose.
 */
export async function GET() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const result: Record<string, unknown> = {
    ok: false,
    app: "Bakers Whisper",
    time: new Date().toISOString(),
    env: {
      hasDatabaseUrl: Boolean(databaseUrl),
      maskedDatabaseUrl: maskDatabaseUrl(databaseUrl),
      hasBridgeToken: Boolean(process.env.BRIDGE_TOKEN),
    },
    checks: {},
  };

  try {
    await db.execute(sql`select 1`);
    result.checks = { database: true };

    const [m] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages);
    const [w] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clientWindows);
    const [g] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gseState);

    result.ok = true;
    result.counts = {
      messages: m.count,
      windows: w.count,
      gseStates: g.count,
    };
    return Response.json(result);
  } catch (error) {
    result.checks = { database: false };
    result.error = errorToDebug(error);
    result.help = [
      "Confira se DATABASE_URL na Vercel é a Pooled connection string do Neon.",
      "Ela deve conter -pooler no hostname e sslmode=require no final.",
      "Depois de alterar Environment Variables na Vercel, clique em Redeploy.",
      "Se as tabelas ainda não existem no Neon, rode: npx drizzle-kit push com .env apontando para o Neon.",
    ];
    return Response.json(result, { status: 500 });
  }
}
