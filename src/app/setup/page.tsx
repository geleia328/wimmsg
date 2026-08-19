import Link from "next/link";
import { Layout } from "@/components/Layout";

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
        {n}
      </div>
      <div className="flex-1">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <div className="mt-1 space-y-2 text-sm text-slate-400">{children}</div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Layout>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <div className="space-y-7 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 md:p-8">
          <Step n={1} title="Crie as tabelas do banco">
            <p>
              Vá em{" "}
              <Link href="/settings" className="text-amber-400 hover:underline">
                Config
              </Link>{" "}
              e clique em <strong className="text-slate-200">Criar tabelas</strong>.
            </p>
          </Step>

          <Step n={2} title="Configure o token do bridge">
            <p>
              Na mesma página, defina ou <strong className="text-slate-200">gere</strong> um
              bridge token.
            </p>
          </Step>

          <Step n={3} title="Baixe o app desktop">
            <p>
              <a
                href="https://github.com/geleia328/wimmsg/releases/latest"
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 hover:underline"
              >
                Baixe o BakersWhisper.exe
              </a>{" "}
              e rode no PC com o WoW.
            </p>
          </Step>

          <Step n={4} title="Instale o addon no WoW">
            <p>
              Baixe <code className="bg-black/40 px-1 text-emerald-300">WIMBridge.lua</code> e
              coloque na pasta de addons.
            </p>
          </Step>

          <Step n={5} title="Ative o chatlog no jogo">
            <p>
              Dentro do WoW, digite <code className="bg-black/40 px-1 text-emerald-300">/chatlog</code>. Isso é obrigatório.
            </p>
          </Step>

          <Step n={6} title="Configure o .exe">
            <p>
              Informe a URL deste site e o token do bridge. Mapeie cada janela do WoW para o
              personagem correspondente.
            </p>
          </Step>

          <Step n={7} title="Pronto! 💬">
            <p>
              Whispers aparecerão na{" "}
              <Link href="/" className="text-amber-400 hover:underline">
                página de Chat
              </Link>
              . Digite a resposta e o bridge a envia para o jogo.
            </p>
          </Step>
        </div>
      </div>
    </Layout>
  );
}
