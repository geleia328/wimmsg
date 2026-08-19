import Link from "next/link";
import { Layout } from "@/components/Layout";

export default function DownloadPage() {
  return (
    <Layout>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 md:flex md:items-center md:justify-center">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center">
            <h2 className="text-lg font-semibold text-slate-100">
              BakersWhisper.exe (Windows)
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              App desktop que roda junto com o WoW.
            </p>
            <a
              href="https://github.com/geleia328/wimmsg/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-amber-500"
            >
              ⬇️ Baixar do GitHub Releases
            </a>
          </div>

          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6">
            <h2 className="text-lg font-semibold text-rose-200">
              Hotfix WinOCR v1.4.4
            </h2>
            <p className="mt-1 text-sm text-rose-100/80">
              Corrige o erro do .exe antigo: <code className="rounded bg-black/30 px-1">module 'winocr' has no attribute 'recognize_pil_image'</code>.
              Depois de aplicar, gere um novo release do BakersWhisper.exe.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="/downloads/patch_winocr_v144.py"
                className="rounded-lg bg-rose-500/20 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/30"
              >
                script automático
              </a>
              <a
                href="/downloads/winocr_v144_hotfix.patch"
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/20"
              >
                patch v1.4.4
              </a>
              <a
                href="/downloads/ocr_bridge.py"
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/20"
              >
                ocr_bridge.py corrigido
              </a>
              <a
                href="/downloads/requirements.txt"
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/20"
              >
                requirements.txt
              </a>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/setup"
              className="text-sm font-medium text-amber-400 hover:text-amber-300"
            >
              Veja o tutorial completo de setup →
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
