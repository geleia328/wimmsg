import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Servidor de downloads.
 *
 * Para o .exe:
 *   1) Se a env BRIDGE_EXE_URL estiver setada, faz redirect 302 pra ela
 *      (use isto: o .exe fica no GitHub Releases e o site só aponta).
 *   2) Se existir public/downloads/BakersWhisper.exe, redireciona ao CDN
 *      estático (evita carregar o binário inteiro na função serverless).
 *   3) Senão, devolve 404 com mensagem amigável.
 *
 * Para os outros arquivos, serve de public/downloads.
 */

const TEXT_FILES: Record<string, { path: string; ctype: string }> = {
  "WIMBridge.lua": { path: "WIMBridge.lua", ctype: "text/plain; charset=utf-8" },
  "WIMBridge.toc": { path: "WIMBridge.toc", ctype: "text/plain; charset=utf-8" },
  "config.example.ini": { path: "config.example.ini", ctype: "text/plain; charset=utf-8" },
  "requirements.txt": { path: "requirements.txt", ctype: "text/plain; charset=utf-8" },
  "LEIA-ME.txt": { path: "LEIA-ME.txt", ctype: "text/plain; charset=utf-8" },
  // código-fonte, escondido na UI mas continua acessível por URL
  "wim_bridge_ocr.py": { path: "wim_bridge_ocr.py", ctype: "text/x-python; charset=utf-8" },
  "wim_bridge.py": { path: "wim_bridge.py", ctype: "text/x-python; charset=utf-8" },
};

const EXE_NAME = "BakersWhisper.exe";
const EXE_LOCAL = join(process.cwd(), "public", "downloads", EXE_NAME);
const EXE_URL = process.env.BRIDGE_EXE_URL?.trim();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  // ---- .exe (binário) -------------------------------------------------
  if (file === EXE_NAME || file === "BakersWhisper.exe") {
    if (EXE_URL) {
      return NextResponse.redirect(EXE_URL, { status: 302 });
    }
    try {
      await stat(EXE_LOCAL);
      // Arquivos grandes devem ser servidos pelo CDN estático, não carregados
      // por inteiro em uma função serverless.
      return NextResponse.redirect(
        new URL(`/downloads/${EXE_NAME}`, _request.url),
        { status: 302 },
      );
    } catch {
      return NextResponse.json(
        {
          error: "exe_not_published",
          message:
            "O BakersWhisper.exe ainda não foi publicado. Defina BRIDGE_EXE_URL no .env " +
            "apontando para o GitHub Releases, ou coloque o .exe em public/downloads/.",
        },
        { status: 404 },
      );
    }
  }

  // ---- arquivos texto --------------------------------------------------
  const entry = TEXT_FILES[file];
  if (!entry) {
    return NextResponse.json({ error: "unknown_file" }, { status: 404 });
  }
  try {
    const body = await readFile(join(process.cwd(), "public", "downloads", entry.path));
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": entry.ctype,
        "content-disposition": `attachment; filename="${file}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }
}
