import NavBar from "@/components/NavBar";
import Link from "next/link";

export const dynamic = "force-dynamic";

const items: Array<{ file: string; title: string; desc: string }> = [
  {
    file: "wim_bridge_gui.py",
    title: "wim_bridge_gui.py",
    desc: "Bridge Python com interface gráfica. Detecta janelas WoW, lê WoWChatLog, captura TTS→STT e envia whispers.",
  },
  {
    file: "wim_bridge.py",
    title: "wim_bridge.py",
    desc: "Núcleo CLI do bridge (headless).",
  },
  {
    file: "wim_bridge_stt.py",
    title: "wim_bridge_stt.py",
    desc: "Módulo de captura loopback + faster-whisper. Lê whispers pela voz do addon (bypass do WoWChatLog).",
  },
  {
    file: "requirements.txt",
    title: "requirements.txt",
    desc: "Dependências base (requests, psutil, pyperclip, pywin32).",
  },
  {
    file: "requirements-stt.txt",
    title: "requirements-stt.txt",
    desc: "Extras para STT (numpy, soundcard, faster-whisper). Instale só se ativar leitura por voz.",
  },
  {
    file: "config.example.ini",
    title: "config.example.ini",
    desc: "Exemplo de configuração local do bridge, com seção [stt].",
  },
  {
    file: "WIMBridge.zip",
    title: "WIMBridge.zip",
    desc: "Addon do WoW (2.6.0). Extraia em World of Warcraft/_retail_/Interface/AddOns/. Já vem com TTS estruturado.",
  },
];

export default function DownloadPage() {
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Downloads</h1>
        <p className="mt-1 text-sm text-slate-400">
          Componentes locais necessários para conectar o WoW ao Bakers Whisper.
        </p>
        <div className="mt-6 space-y-3">
          {items.map((i) => (
            <div
              key={i.file}
              className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-mono font-medium text-emerald-400">{i.title}</div>
                <div className="mt-1 text-sm text-slate-400">{i.desc}</div>
              </div>
              <a
                href={`/api/download/${encodeURIComponent(i.file)}`}
                className="inline-block whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500"
              >
                ⬇ Baixar
              </a>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          <div className="font-medium">Passo a passo rápido</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
            <li>Instale Python 3.10+ no Windows.</li>
            <li>
              Baixe <span className="font-mono">wim_bridge_gui.py</span> e{" "}
              <span className="font-mono">requirements.txt</span>.
            </li>
            <li>
              Rode <span className="font-mono">pip install -r requirements.txt</span>.
            </li>
            <li>
              Extraia <span className="font-mono">WIMBridge.zip</span> em{" "}
              <span className="font-mono">World of Warcraft/_retail_/Interface/AddOns/</span>.
            </li>
            <li>
              Ative <span className="font-mono">/chatlog</span> no jogo (o addon faz isso).
            </li>
            <li>
              Configure a URL do site e o <span className="font-mono">BRIDGE_TOKEN</span>, rode o bridge.
            </li>
          </ol>
          <div className="mt-3">
            Veja <Link href="/setup" className="text-emerald-400 hover:underline">/setup</Link> para instruções detalhadas.
          </div>
        </div>
      </div>
    </>
  );
}
