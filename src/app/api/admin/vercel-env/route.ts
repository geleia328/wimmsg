import { checkAdminAuth, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) return unauthorized();
  return Response.json({
    ok: true,
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasBridgeToken: !!process.env.BRIDGE_TOKEN,
      hasAdminToken: !!process.env.ADMIN_TOKEN,
      node: process.version,
      nodeEnv: process.env.NODE_ENV,
    },
  });
}
