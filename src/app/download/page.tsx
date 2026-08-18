import Link from "next/link";

export const dynamic = "force-dynamic";

const GITHUB_REPO = "geleia328/wimmsg";
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const DIRECT_EXE_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/BakersWhisper.exe`;

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-500 to-amber-700 text-4xl shadow-2xl sm:h-20 sm:w-20 sm:text-5xl">
          🥐
        </div>
        <h1 className="mt-4 text-3xl font-black sm:text-4xl">Bakers Whisper</h1>
        <p className="mt-2 text-slate-400">
          Receba e responda whispers do WoW pelo navegador
        </p>
      </div>

      <div className="mt-10 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 text-center sm:p-8">
        <div className="text-5xl sm:text-6xl">⬇️</div>
        <h2 className="mt-4 text-xl font-bold sm:text-2xl">Baixar para Windows</h2>
        <p className="mt-2 text-sm text-slate-400">
          Aplicativo pronto pra usar — só baixar e abrir.
          <br />
          Sem instalar Python. Se precisar, dá para trocar API URL e Token dentro do app.
        </p>
        <a
          href={DIRECT_EXE_URL}
          className="mt-6 inline-block w-full rounded-xl bg-emerald-500 px-6 py-4 text-base font-bold text-slate-950 shadow-lg hover:bg-emerald-400 sm:w-auto sm:px-8 sm:text-lg"
        >
          📥 Baixar BakersWhisper.exe
        </a>
        <p className="mt-3 text-xs text-slate-500">
          Windows 10 ou 11 · ~30 MB
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        <b className="text-amber-300">⚠ Aviso do Windows Defender</b>
        <p className="mt-1 text-xs">
          Como o app não é assinado (assinatura custa $$$), o Windows pode mostrar
          um aviso azul dizendo &quot;<i>Windows protegeu o seu PC</i>&quot;. É
          normal. Clique em <b>&quot;Mais informações&quot;</b> e depois em{" "}
          <b>&quot;Executar assim mesmo&quot;</b>.
        </p>
      </div>

      <div className="mt-10">
        <h3 className="text-lg font-bold text-amber-300">Como usar</h3>
        <ol className="mt-4 space-y-4 text-sm text-slate-300">
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
              1
            </span>
            <div>
              <b>Abra o WoW</b> em cada janela que você quer monitorar
              (pode ter várias contas ao mesmo tempo).
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
              2
            </span>
            <div>
              <b>Em cada janela</b>, digite no chat do jogo:{" "}
              <code className="rounded bg-slate-800 px-1.5">/chatlog</code> e
              aperte Enter.
              <div className="mt-1 text-xs text-amber-400">
                ⚠ Precisa fazer isso <b>toda vez</b> que abrir o WoW.
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
              3
            </span>
            <div>
              <b>Abra o BakersWhisper.exe.</b> Ele vai listar todas as janelas
              do WoW detectadas.
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
              4
            </span>
            <div>
              <b>Confira a seção Servidor no app.</b> Normalmente ela já vem
              preenchida. Se aparecer &quot;sem conexão&quot;, coloque:
              <div className="mt-2 rounded bg-slate-950 p-2 font-mono text-xs text-slate-300">
                API URL: https://wimmsg-lntm.vercel.app
                <br />
                Token: o mesmo BRIDGE_TOKEN configurado na Vercel
              </div>
              Clique em <b>💾 Salvar servidor</b> e depois <b>🌐 Testar</b>.
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
              5
            </span>
            <div>
              <b>Digite o nome completo do personagem</b> ao lado de cada
              janela — sempre no formato{" "}
              <code className="rounded bg-slate-800 px-1.5">Nome-Reino</code>{" "}
              (ex.{" "}
              <code className="rounded bg-slate-800 px-1.5">Aragorn-Nemesis</code>
              ).
              <div className="mt-1 text-xs text-slate-500">
                O -Reino é importante — sem ele, o site não consegue avisar se
                você está tentando responder alguém de outro servidor.
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
              6
            </span>
            <div>
              Clique em <b>▶ Iniciar</b>. As janelas do WoW são renomeadas
              automaticamente para{" "}
              <code className="rounded bg-slate-800 px-1.5">wow1</code>,{" "}
              <code className="rounded bg-slate-800 px-1.5">wow2</code>, etc.
              <div className="mt-1 text-xs text-slate-500">
                Deixe o app aberto — ele é a ponte entre o jogo e o site.
              </div>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 font-bold text-slate-950">
              ✓
            </span>
            <div>
              Abra este site (
              <a href="/" className="text-emerald-400 underline">
                aqui
              </a>
              ) no navegador — pode ser <b>no celular</b> também! Os whispers
              vão aparecer em tempo real, e você responde direto por lá.
            </div>
          </li>
        </ol>
      </div>

      {/* GSE section */}
      <div className="mt-10 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/5 p-6">
        <h3 className="text-lg font-bold text-fuchsia-300">
          ⚙ (Opcional) Controle GSE — rotação de macros
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          Se você usa o addon <b>GSE - Advanced Macros</b> no WoW, dá pra
          ligar/desligar a rotação de cada personagem direto pelo site.
        </p>
        <ol className="mt-4 space-y-3 text-sm text-slate-300">
          <li>
            1. Instale o addon <b>GSE - Advanced Macros</b> pelo{" "}
            <a
              href="https://www.curseforge.com/wow/addons/gse-advanced-macros"
              className="text-fuchsia-400 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              CurseForge
            </a>{" "}
            (ou WoWUp).
          </li>
          <li>
            2. Crie sua macro no GSE e coloque ela em uma tecla da barra de
            ação (ex.{" "}
            <code className="rounded bg-slate-800 px-1.5">1</code>,{" "}
            <code className="rounded bg-slate-800 px-1.5">F1</code>).
          </li>
          <li>
            3. Abra a aba{" "}
            <a href="/gse" className="text-fuchsia-400 underline">
              ⚙ GSE
            </a>{" "}
            neste site.
          </li>
          <li>
            4. Configure a mesma tecla no campo <b>&quot;Tecla GSE&quot;</b>{" "}
            de cada personagem.
          </li>
          <li>
            5. Clique <b>▶ Iniciar TODOS</b>. Pronto — a rotação roda em{" "}
            <b>background</b>, sem precisar deixar a janela do WoW em foco.
          </li>
        </ol>
        <div className="mt-4 rounded border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400">
          🧠 <b className="text-fuchsia-300">Como funciona sem bugar:</b>{" "}
          quando chega um whisper e você responde, a rotação daquela janela
          pausa por 1s, o site digita a mensagem, e o GSE volta sozinho. As
          outras janelas continuam rodando sem parar.
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="mt-10 rounded-xl border border-slate-700 bg-slate-900/60 p-6">
        <h3 className="text-lg font-bold text-slate-200">
          ❓ Problemas comuns
        </h3>
        <div className="mt-4 space-y-4 text-sm text-slate-300">
          <div>
            <b className="text-amber-300">Windows bloqueou o programa</b>
            <p className="mt-1 text-xs text-slate-400">
              É o SmartScreen. Clique em <b>&quot;Mais informações&quot;</b>{" "}
              → <b>&quot;Executar assim mesmo&quot;</b>. Só acontece na
              primeira vez.
            </p>
          </div>
          <div>
            <b className="text-amber-300">O app não detecta as janelas do WoW</b>
            <p className="mt-1 text-xs text-slate-400">
              Abre o WoW <b>antes</b> do BakersWhisper. Se já estava aberto,
              clica em <b>🔄 Rescan</b> no app.
            </p>
          </div>
          <div>
            <b className="text-amber-300">
              Log mostra ❌ /chatlog na frente da janela
            </b>
            <p className="mt-1 text-xs text-slate-400">
              Você esqueceu de digitar{" "}
              <code className="rounded bg-slate-800 px-1.5">/chatlog</code>{" "}
              nessa janela. Digite dentro do jogo e clique 🔄 Rescan.
            </p>
          </div>
          <div>
            <b className="text-amber-300">
              O whisper não é enviado quando eu respondo
            </b>
            <p className="mt-1 text-xs text-slate-400">
              Confere se a janela do WoW aparece como{" "}
              <b>online</b> na aba{" "}
              <a href="/accounts" className="text-emerald-400 underline">
                Contas
              </a>
              . Se estiver, veja o log no app — costuma ser aviso de
              &quot;janela não encontrada&quot; (fecharam o WoW enquanto o
              app rodava).
            </p>
          </div>
          <div>
            <b className="text-amber-300">
              Antivírus deletou o BakersWhisper.exe
            </b>
            <p className="mt-1 text-xs text-slate-400">
              Alguns antivírus dão falso positivo em .exe compilados com
              PyInstaller. Adicione a pasta como exceção e baixe de novo.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-lg border border-slate-700 bg-slate-800 px-5 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          🥐 Abrir painel de whispers
        </Link>
        <a
          href={RELEASES_URL}
          className="rounded-lg border border-slate-700 bg-slate-800 px-5 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          📦 Ver todas as versões
        </a>
        <Link
          href="/setup"
          className="rounded-lg border border-slate-700 bg-slate-800 px-5 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          ⚙ Setup avançado
        </Link>
      </div>
    </div>
  );
}
