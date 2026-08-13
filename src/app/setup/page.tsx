import Link from "next/link";

export const dynamic = "force-dynamic";

const CODE_BLOCK =
  "rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs overflow-x-auto";

export default function SetupPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="text-xs text-amber-400 hover:underline">
        ← voltar ao chat
      </Link>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
        Setup do Bakers Whisper
      </h1>
      <p className="mt-2 text-slate-400">
        Modo <b>multi-janela</b>: você abre várias sessões do WoW no mesmo PC,
        vê todos os whispers agregados aqui e responde manualmente pelo site.
        Cada resposta é entregue pelo Python na janela do personagem certo.
      </p>
      <p className="mt-2 text-sm">
        <Link
          href="/accounts"
          className="rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-emerald-300 hover:bg-emerald-500/20"
        >
          📡 Abrir varredura de contas
        </Link>{" "}
        para ver as janelas do WoW detectadas em tempo real.{" "}
        <a
          href="/report"
          target="_blank"
          rel="noreferrer"
          className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
        >
          📄 Relatório completo do projeto
        </a>
      </p>

      <div className="mt-8 space-y-8">
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-5">
          <h2 className="text-xl font-semibold text-emerald-300">
            🚀 Hospedagem grátis (Vercel + Neon)
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Combinação 100% grátis, sem cartão de crédito, com domínio HTTPS
            incluso:
          </p>
          <ol className="mt-3 list-decimal space-y-3 pl-6 text-sm text-slate-300">
            <li>
              <b>Suba o código pro GitHub</b> (repositório público ou privado,
              tanto faz).
            </li>
            <li>
              Crie uma conta grátis em{" "}
              <a
                href="https://neon.tech"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline"
              >
                neon.tech
              </a>
              , crie um projeto Postgres, e copie a <b>Pooled connection</b>{" "}
              string (contém <code>-pooler</code> no hostname, algo como{" "}
              <code>
                postgresql://user:pass@ep-xxx-pooler.neon.tech/neondb?sslmode=require
              </code>
              ). O pooler é essencial em serverless — evita esgotar as
              conexões do Postgres. Free tier: 0.5 GB + 190 h de compute/mês.
            </li>
            <li>
              Crie uma conta grátis em{" "}
              <a
                href="https://vercel.com"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline"
              >
                vercel.com
              </a>{" "}
              → <b>Add New… → Project</b> → importe o repo do GitHub.
            </li>
            <li>
              Na tela de deploy, em <b>Environment Variables</b>, adicione:
              <pre className={`${CODE_BLOCK} mt-2`}>
                {`DATABASE_URL = <a connection string do Neon>
BRIDGE_TOKEN = <um token aleatório longo>`}
              </pre>
              O <code>BRIDGE_TOKEN</code> é o segredo compartilhado com o seu
              Python — sem ele, qualquer um consegue ler seus whispers.
              Gere um bem aleatório (ex.{" "}
              <code>openssl rand -hex 32</code>).
            </li>
            <li>Clique <b>Deploy</b>. Aguarde 1–2 min.</li>
            <li>
              Após o deploy, rode <b>uma vez</b> o comando abaixo no seu PC
              (com <code>DATABASE_URL</code> apontando para o Neon) para
              criar a tabela:
              <pre className={`${CODE_BLOCK} mt-2`}>{`npx drizzle-kit push`}</pre>
            </li>
            <li>
              Seu site estará em{" "}
              <code>https://bakers-whisper.vercel.app</code> (o nome exato
              depende do que você escolher no Vercel).
            </li>
            <li>
              No <code>config.ini</code> do Python bridge, ajuste:
              <pre className={`${CODE_BLOCK} mt-2`}>{`api_url = https://bakers-whisper.vercel.app
token   = <o mesmo BRIDGE_TOKEN>`}</pre>
            </li>
          </ol>

          <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <b>Observação:</b> o polling a cada 2s (site + bridge) consome
            invocações no plano grátis. Uso pessoal cabe tranquilo, mas se
            você deixar aberto 24/7 em várias abas, pode encostar no limite.
            Alternativas: rodar tudo local (<code>npm run build &amp;&amp; npm
            start</code>), <a
              href="https://render.com"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Render
            </a>{" "}
            (free + spin-down) ou{" "}
            <a
              href="https://railway.app"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Railway
            </a>{" "}
            ($5 grátis/mês).
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            1. Arquitetura
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm text-slate-300">
            <li>
              Cada janela do WoW roda com o addon <code>WIMBridge</code>{" "}
              instalado. Ele ecoa cada whisper recebido no log de chat com o
              marcador <code>[WIMBRIDGE]&lt;OWN:SeuChar-Reino&gt;&lt;FROM:Fulano-Reino&gt;msg</code>
              .
            </li>
            <li>
              Ative <code>/chatlog</code> em cada janela — isso grava tudo em{" "}
              <code>_retail_/Logs/WoWChatLog.txt</code>.
            </li>
            <li>
              O script Python observa esses arquivos em paralelo e envia os
              whispers para este site.
            </li>
            <li>
              Você lê tudo aqui num só painel, filtra por personagem, e
              responde manualmente. Cada resposta vai para uma fila.
            </li>
            <li>
              O Python pega da fila, <b>foca a janela correta</b> (pelo título)
              e digita <code>/w Nome mensagem</code>.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            2. Preparando as janelas do WoW
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Para o auto-focus funcionar, cada janela precisa de um{" "}
            <b>título único</b>. Duas formas:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-slate-300">
            <li>
              Ter instalações separadas do WoW em pastas distintas (ex.{" "}
              <code>C:\Games\WoW-Inst1\</code>, <code>WoW-Inst2\</code>, ...) e
              usar um utilitário simples de renomear janela como{" "}
              <a
                href="https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwindowtexta"
                className="text-amber-400 hover:underline"
              >
                SetWindowText
              </a>{" "}
              ou o utilitário AutoHotkey <code>WinSetTitle</code>.
            </li>
            <li>
              Rodar cada instância com o argumento{" "}
              <code>-WindowTitle &quot;WoW - Aragorn&quot;</code> quando aplicável
              (varia por launcher).
            </li>
          </ul>
          <p className="mt-2 text-sm text-slate-300">
            Depois, em cada janela, dentro do jogo, ative:
          </p>
          <pre className={CODE_BLOCK}>/chatlog</pre>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            3. Instalar o addon WIMBridge
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Baixe os dois arquivos abaixo e coloque-os manualmente na pasta do
            addon:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-sm">
            <li>
              Crie exatamente esta pasta (sem uma segunda pasta WIMBridge dentro
              dela):{" "}
              <code>World of Warcraft/_retail_/Interface/AddOns/WIMBridge/</code>
            </li>
            <li>
              Dentro dela, salve os arquivos{" "}
              <a
                href="/api/download/WIMBridge.toc"
                className="text-amber-400 hover:underline"
                download
              >
                WIMBridge.toc
              </a>{" "}
              e{" "}
              <a
                href="/api/download/WIMBridge.lua"
                className="text-amber-400 hover:underline"
                download
              >
                WIMBridge.lua
              </a>
              . O caminho final precisa ser exatamente:
              <pre className={`${CODE_BLOCK} mt-2`}>{`.../Interface/AddOns/WIMBridge/WIMBridge.toc
.../Interface/AddOns/WIMBridge/WIMBridge.lua`}</pre>
            </li>
          </ul>

          <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-slate-300">
            <b className="text-rose-300">Se /wimbridge disser &quot;comando desconhecido&quot;</b>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Na tela de seleção de personagem, clique no ícone de addons e
                marque <b>Load out of date AddOns / Carregar addons antigos</b>.
              </li>
              <li>
                Confira que a pasta tem exatamente dois arquivos, sem dupla
                pasta: <code>AddOns/WIMBridge/WIMBridge.toc</code> e{" "}
                <code>AddOns/WIMBridge/WIMBridge.lua</code>.
              </li>
              <li>
                Entre no personagem e use <code>/reload</code>. Veja no chat a
                mensagem <b>WIMBridge v2.2 carregado!</b>.
              </li>
              <li>
                Teste qualquer alias: <code>/wimbridge who</code>,{" "}
                <code>/wim who</code> ou <code>/wbridge who</code>.
              </li>
            </ol>
            <p className="mt-2 text-slate-400">
              Se ainda não aparecer a mensagem de carregamento, o arquivo está
              na pasta errada ou o addon está desmarcado — o problema acontece
              antes do parser/bridge.
            </p>
          </div>

          <p className="mt-3 text-sm text-slate-300">
            Depois de copiar os arquivos, faça <code>/reload</code> em cada
            janela do WoW. Teste com <code>/wimbridge who</code> (ou o alias{" "}
            <code>/wim who</code>) — deve mostrar o personagem próprio e
            confirmar que o addon carregou.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            4. Instalar o Python bridge
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Baixe:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
            <li>
              <a
                href="/api/download/wim_bridge.py"
                className="text-amber-400 hover:underline"
                download
              >
                wim_bridge.py
              </a>
            </li>
            <li>
              <a
                href="/api/download/requirements.txt"
                className="text-amber-400 hover:underline"
                download
              >
                requirements.txt
              </a>
            </li>
            <li>
              <a
                href="/api/download/config.example.ini"
                className="text-amber-400 hover:underline"
                download
              >
                config.example.ini
              </a>{" "}
              → copie para <code>config.ini</code>.
            </li>
          </ul>

          <pre className={CODE_BLOCK}>{`pip install -r requirements.txt`}</pre>

          <p className="mt-3 text-sm text-slate-300">
            Edite <code>config.ini</code> e adicione UM bloco por janela:
          </p>
          <pre className={CODE_BLOCK}>{`[bridge]
api_url = http://localhost:3000
poll_interval = 1.0
auto_focus = true

[character:Aragorn-Nemesis]
chat_log = C:\\Games\\WoW-Inst1\\_retail_\\Logs\\WoWChatLog.txt
window_title = WoW - Aragorn

[character:Legolas-Nemesis]
chat_log = C:\\Games\\WoW-Inst2\\_retail_\\Logs\\WoWChatLog.txt
window_title = WoW - Legolas

# ... até 20+ personagens`}</pre>

          <p className="mt-3 text-sm text-slate-300">Rode:</p>
          <pre className={CODE_BLOCK}>{`python wim_bridge.py`}</pre>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            5. Como funciona o envio com 20+ janelas
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-sm text-slate-300">
            <li>
              O envio é <b>serializado</b> por um mutex global no Python: uma
              mensagem por vez, para não misturar teclas entre janelas.
            </li>
            <li>
              Antes de digitar, o bridge <b>foca</b> a janela cujo{" "}
              <code>window_title</code> bate com o do personagem. Se você
              estiver interagindo com o PC nesse instante, o foco será tomado
              — planeje: rode isso em uma máquina dedicada ou em segundo
              monitor.
            </li>
            <li>
              Se a janela não for encontrada, a mensagem fica marcada como{" "}
              <code>failed</code> com o erro. Você pode ver e reenviar.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            6. Limitações honestas
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 text-sm text-slate-300">
            <li>
              Addons não podem fazer HTTP — a leitura depende do{" "}
              <code>WoWChatLog.txt</code>.
            </li>
            <li>
              Envio requer que a janela alvo receba foco por instantes —
              qualquer input seu enquanto isso acontece pode interferir.
            </li>
            <li>
              Whispers &gt;255 chars são bloqueados no site.
            </li>
            <li>
              Blizzard considera automação de input contra o ToS. Isso é uma
              ferramenta de conveniência pessoal (você escreve toda mensagem),
              mas mesmo assim o risco é seu.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-amber-300">
            7. Testando sem o WoW
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Simule whispers vindos de várias janelas via curl:
          </p>
          <pre className={CODE_BLOCK}>{`curl -X POST http://localhost:3000/api/ingest \\
  -H "content-type: application/json" \\
  -d '{"messages":[
    {"character":"Aragorn-Nemesis","player":"Thrall-Nemesis","body":"For the Horde!"},
    {"character":"Legolas-Nemesis","player":"Sylvanas-Windrunner","body":"M+ 15?"}
  ]}'`}</pre>
        </section>
      </div>
    </div>
  );
}
