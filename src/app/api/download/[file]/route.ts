import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "wim_bridge_gui.py",
  "wim_bridge.py",
  "wim_bridge_stt.py",
  "requirements.txt",
  "requirements-stt.txt",
  "config.example.ini",
  "WIMBridge.zip",
]);

const MIME: Record<string, string> = {
  ".py": "text/x-python; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

type Params = { params: Promise<{ file: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { file } = await params;
  const name = decodeURIComponent(file);
  if (!ALLOWED.has(name)) {
    return new Response("not found", { status: 404 });
  }
  const path = normalize(join(process.cwd(), "public", "downloads", name));
  try {
    await stat(path);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const data = await readFile(path);
  const ext = name.slice(name.lastIndexOf("."));
  const mime = MIME[ext] || "application/octet-stream";
  const body = new Uint8Array(data);
  return new Response(body, {
    headers: {
      "content-type": mime,
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
