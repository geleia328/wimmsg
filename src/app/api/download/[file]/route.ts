import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN: Record<string, string> = {
  "BakersWhisper.exe":
    "https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe",
  "wim_bridge_gui.py":
    "https://raw.githubusercontent.com/geleia328/wimmsg/main/public/downloads/wim_bridge_gui.py",
  "whisper_announcer.py":
    "https://raw.githubusercontent.com/geleia328/wimmsg/main/public/downloads/whisper_announcer.py",
  "requirements.txt":
    "https://raw.githubusercontent.com/geleia328/wimmsg/main/public/downloads/requirements.txt",
  "config.example.ini":
    "https://raw.githubusercontent.com/geleia328/wimmsg/main/public/downloads/config.example.ini",
  "wim_bridge.py":
    "https://raw.githubusercontent.com/geleia328/wimmsg/main/public/downloads/wim_bridge.py",
  "WIMBridge.lua":
    "https://raw.githubusercontent.com/geleia328/wimmsg/main/public/downloads/WIMBridge/WIMBridge.lua",
};

const CONTENT_TYPES: Record<string, string> = {
  ".exe": "application/vnd.microsoft.portable-executable",
  ".py": "text/x-python; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".lua": "text/plain; charset=utf-8",
};

function contentTypeFor(file: string) {
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Public downloads. Prefer local patched files in public/downloads; fall back
 * to GitHub raw for files that are not bundled in this deployment.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!KNOWN[file]) {
    return NextResponse.json({ error: "unknown_file" }, { status: 404 });
  }

  try {
    const localPath = join(process.cwd(), "public", "downloads", file);
    const body = await readFile(localPath);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": contentTypeFor(file),
        "content-disposition": `attachment; filename="${file}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.redirect(KNOWN[file], { status: 302 });
  }
}
