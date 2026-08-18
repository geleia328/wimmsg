import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const path = join(process.cwd(), "docs", "RELATORIO_PARA_PROXIMA_IA.md");
    const md = await readFile(path, "utf8");
    return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  } catch {
    return new Response("relatório indisponível", { status: 404 });
  }
}
