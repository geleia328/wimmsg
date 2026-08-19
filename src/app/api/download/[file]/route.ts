import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public helper that redirects to the right GitHub raw asset so the /setup
 * and /download pages never have to hardcode URLs. Keeping this dynamic makes
 * it trivial to swap the source later.
 */
const KNOWN: Record<string, string> = {
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
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const url = KNOWN[file];
  if (!url) {
    return NextResponse.json({ error: "unknown_file" }, { status: 404 });
  }
  return NextResponse.redirect(url, { status: 302 });
}
