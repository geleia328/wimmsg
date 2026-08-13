import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves files from `public/downloads/` with explicit Content-Type and
 * Content-Disposition: attachment headers. This bypasses two common issues:
 *
 *  1. Some browsers (Chrome, Edge) block .zip files served with generic
 *     application/octet-stream saying the file "isn't commonly downloaded"
 *     unless the server explicitly declares content-type: application/zip.
 *  2. Ad blockers / corporate proxies sometimes mangle direct static file
 *     downloads. Serving via an API route sidesteps most of those.
 */
const ALLOWED = new Set([
  "WIMBridge.zip",
  "wim_bridge.py",
  "requirements.txt",
  "config.example.ini",
  "WIMBridge.lua",
  "WIMBridge.toc",
]);

const MIME: Record<string, string> = {
  ".zip": "application/zip",
  ".py": "text/x-python; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".lua": "text/plain; charset=utf-8",
  ".toc": "text/plain; charset=utf-8",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const safe = decodeURIComponent(file);

  if (!ALLOWED.has(safe)) {
    return new Response("Not found", { status: 404 });
  }

  // Some files are directly in downloads/, WIMBridge.lua/.toc are inside the
  // WIMBridge/ subfolder.
  const candidates = [
    path.join(process.cwd(), "public", "downloads", safe),
    path.join(process.cwd(), "public", "downloads", "WIMBridge", safe),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    return new Response("File missing on server", { status: 404 });
  }

  const data = await readFile(found);
  const ext = path.extname(safe).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";

  const body = new Uint8Array(data);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": mime,
      "content-disposition": `attachment; filename="${safe}"`,
      "content-length": String(data.length),
      "cache-control": "no-store",
    },
  });
}
