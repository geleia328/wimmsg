import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the project report as Markdown for download or printing. */
export async function GET() {
  const candidates = [
    path.join(process.cwd(), "docs", "RELATORIO_COMPLETO.md"),
    path.join(process.cwd(), "docs", "RELATORIO.md"),
  ];

  for (const filePath of candidates) {
    try {
      const body = await fs.readFile(filePath, "utf-8");
      const name = path.basename(filePath);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `inline; filename="${name}"`,
        },
      });
    } catch {
      // Try the next report file.
    }
  }

  return new NextResponse("Relatorio nao encontrado", { status: 404 });
}
