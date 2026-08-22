import Link from "next/link";

export const dynamic = "force-dynamic";

const ENDPOINTS: Array<[string, string, string]> = [
  [
    "POST",
    "/api/ingest",
    "Recebe sussurros novos. Aceita {messages:[{character, player, body, receivedAt, externalId, direction}]}.",
  ],
  [
    "POST",
    "/api/sync",
    "Mesmo formato do ingest — usado para sincronizar o histórico na inicialização.",
  ],
  [
    "GET",
    "/api/queue",
    "Devolve até 50 respostas com status=pending para o bridge digitar.",
  ],
  [
    "POST",
    "/api/queue/{id}/ack",
    "Confirma o envio: {status:'sent'} ou {status:'failed', error:'…'}.",
  ],
  [
    "POST",
    "/api/status/scan",
    "Envia a lista de janelas do WoW abertas ({windows:[{character, hwnd, windowTitle, …}]}).",
  ],
  ["GET", "/api/control", "Lê os timings/módulos que você ajusta na tela de Configurações."],
  [
    "GET",
    "/api/conversations",
    "Lista de conversas do painel (agrupada por personagem + jogador).",
  ],
];

export default function SetupPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Setup / Bridge</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Para usar, você precisa de <b>duas coisas</b>: o{" "}
          <span className="text-emerald-300">BakersWhisper.exe</span> que roda no
          seu PC e o <span className="text-amber-300">addon WIMBridge</span> dentro
          do WoW. Sem Python, sem terminal, sem .ini na mão.
        </p>
      </header>

      {/* ============================================================ */}
      {/* PASSO 1 — BAIXAR O EXE */}
      {/* ============================================================ */}
      <section className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-sky-500/5 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="text-4xl">🥐</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-emerald-300">
              passo 1
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              Baixe o BakersWhisper.exe
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Um único arquivo. Clique no botão, salve em qualquer pasta, dê dois
              cliques pra abrir. Ele já vem com Python, OCR e tudo embutido — você
              <b> não precisa instalar nada</b> além dele.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href="/api/download/BakersWhisper.exe"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-base font-semibold text-emerald-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-400"
              >
                ⬇ Baixar BakersWhisper.exe
              </a>
              <a
                href="/api/download/LEIA-ME.txt"
                className="text-sm text-slate-400 underline hover:text-slate-200"
              >
                ler o manual
              </a>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              O botão aponta para o <code>BRIDGE_EXE_URL</code> configurado no site
              (geralmente o GitHub Releases). Esse .exe é compilado automaticamente
              pelo GitHub Actions toda vez que você faz <code>git push</code> na
              branch <code>main</code> — você nunca precisa compilar nada na mão.
            </p>
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-slate-300">
              <p className="font-semibold text-sky-300">🔄 Build automático (CI/CD)</p>
              <p className="mt-1">
                Cada <code>git push</code> na <code>main</code> dispara o workflow{" "}
                <code>.github/workflows/build-windows.yml</code>. Ele:
              </p>
              <ol className="ml-5 mt-1 list-decimal space-y-0.5 text-slate-400">
                <li>Instala Python 3.11 + winocr + PyWinRT</li>
                <li>Compila <code>wim_bridge_ocr.py</code> com PyInstaller</li>
                <li>Sobe o <code>BakersWhisper.exe</code> numa GitHub Release</li>
                <li>O site aponta pra ela via <code>BRIDGE_EXE_URL</code></li>
              </ol>
              <p className="mt-2 text-slate-400">
                Tag <code>v1.2.3</code> → release versionada. Push na <code>main</code> →
                release &quot;latest&quot; (sempre a mais recente).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* PASSO 2 — INSTALAR O ADDON */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="text-4xl">🪟</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-amber-300">
              passo 2
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              Instale o addon WIMBridge no WoW
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Esse addon desenha a faixa preta/amarela no topo da tela — é o que o
              .exe lê via OCR. Baixe os dois arquivos abaixo e jogue os dois na
              mesma pasta.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                href="/api/download/WIMBridge.lua"
                className="rounded-lg border border-white/10 bg-slate-950/60 px-4 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-500/10"
              >
                ⬇ WIMBridge.lua
              </a>
              <a
                href="/api/download/WIMBridge.toc"
                className="rounded-lg border border-white/10 bg-slate-950/60 px-4 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-500/10"
              >
                ⬇ WIMBridge.toc
              </a>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              Cole os dois arquivos em:
            </p>
              <pre className="bw-scroll mt-1 inline-block overflow-x-auto rounded-lg bg-slate-950/80 px-3 py-2 text-xs text-slate-200">
{`World of Warcraft\\_retail_\\Interface\\AddOns\\WIMBridge\\`}
              </pre>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>
                Abra o WoW, digite <code className="text-amber-200">/reload</code> e
                confirme que o addon carregou (deve aparecer &quot;WIMBridge 3.3.0
                ATIVO&quot; no centro da tela).
              </li>
              <li>
                Aplique os valores recomendados uma vez (eles ficam salvos):
                <pre className="bw-scroll mt-2 inline-block overflow-x-auto rounded-lg bg-slate-950/80 px-3 py-2 text-xs text-slate-200">
{`/wimbridge font 55
/wimbridge size 500
/wimbridge delay 1.8`}
                </pre>
              </li>
              <li>
                <code className="text-amber-200">/wimbridge who</code> — confirme que
                está tudo certo.
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* PASSO 3 — CONFIGURAR O EXE */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="text-4xl">🖥️</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-300">
              passo 3
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Abra o .exe e cadastre suas janelas</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>
                Dê dois cliques no <code className="text-emerald-300">BakersWhisper.exe</code>.
                O Windows pode perguntar se confia no executável — clique em{" "}
                <b>Mais informações → Executar mesmo assim</b>.
              </li>
              <li>
                Ele abre uma janelinha. Preencha:
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-400">
                  <li><b>URL do site</b> — <code>http://localhost:3000</code> se rodar local, ou o endereço da Vercel</li>
                  <li><b>Token</b> — o mesmo <code>BRIDGE_TOKEN</code> do site</li>
                  <li><b>Personagem</b> — ex: <code>fataburns-illidan</code></li>
                  <li><b>Título da janela</b> — ex: <code>WoW - fataburns</code></li>
                </ul>
              </li>
              <li>Clique em <b>Adicionar</b>. O .exe já começa a ler a faixa OCR e mandar pro painel.</li>
              <li>
                Repita para cada janela aberta. Cada janela aberta do WoW é uma linha
                nessa lista.
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* REGRAS */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-300">
          ⚠️ Por que o OCR erra — e como evitar
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-200">
          <li>
            • <b>O nome do jogador e do realm são sempre alfabéticos</b>. Se o OCR
            devolver algo como <code>bleedingh0110w</code> ou <code>1llidan</code> o
            painel <b>rejeita</b> automaticamente — você vê o erro e a mensagem
            não é inserida (evita a duplicação de chat que existia antes).
          </li>
          <li>
            • Use <b>/wimbridge font 55</b> e <b>/wimbridge size 500</b> — fonte
            pequena demais + faixa baixa = OCR confunde letras parecidas.
          </li>
          <li>
            • A faixa precisa ficar visível por pelo menos <b>1.5s</b>{" "}
            (<code>/wimbridge delay 1.8</code>). Mais rápido e o OCR perde linhas.
          </li>
          <li>
            • <b>Não usamos mais o /combatlog nem /wowlog</b> — o .exe ignora esses
            arquivos. O único caminho confiável é o OCR da faixa.
          </li>
          <li>
            • O servidor <b>Illidan</b> agora é comparado case-insensitive. Sua
            janela em <code>illidan</code> e sussurro de <code>Illidan</code> são
            a mesma conversa.
          </li>
        </ul>
      </section>

      {/* ============================================================ */}
      {/* API (avançado) */}
      {/* ============================================================ */}
      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Contrato da API (pra quem quiser escrever um bridge próprio)
        </h2>
        <div className="bw-scroll mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Método</th>
                <th className="py-2 pr-3">Rota</th>
                <th className="py-2">O que faz</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ENDPOINTS.map(([method, path, desc]) => (
                <tr key={path + method} className="align-top">
                  <td className="py-2 pr-3 font-mono text-xs text-emerald-300">
                    {method}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-sky-300">{path}</td>
                  <td className="py-2 text-slate-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============================================================ */}
      {/* FONTE .PY (recolhido) */}
      {/* ============================================================ */}
      <details className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">
          🛠 Código-fonte (.py) — só pra quem for recompilar o .exe
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          Usuário final <b>não precisa</b> disto. O .exe já vem com tudo embutido.
          Esses arquivos são só pra você, dono do projeto, compilar uma nova versão
          do executável.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <a
            href="/api/download/wim_bridge_ocr.py"
            className="rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2 text-xs text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
          >
            wim_bridge_ocr.py
          </a>
          <a
            href="/api/download/wim_bridge.py"
            className="rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2 text-xs text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
          >
            wim_bridge.py (legado, log)
          </a>
          <a
            href="/api/download/requirements.txt"
            className="rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2 text-xs text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
          >
            requirements.txt
          </a>
          <a
            href="/api/download/config.example.ini"
            className="rounded-lg border border-white/5 bg-slate-950/40 px-3 py-2 text-xs text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
          >
            config.example.ini
          </a>
        </div>
      </details>

      <p className="text-center text-xs text-slate-500">
        Problemas? Veja a aba{" "}
        <Link href="/diagnosticos" className="text-emerald-400 underline">
          diagnósticos
        </Link>{" "}
        do painel.
      </p>
    </div>
  );
}
