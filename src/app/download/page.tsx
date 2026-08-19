import Link from "next/link";

export default function DownloadPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-500 to-amber-700 text-4xl shadow-2xl sm:h-20 sm:w-20 sm:text-5xl">
          🥐
        </div>
        <h1 className="mt-4 text-3xl font-black sm:text-4xl">Bakers Whisper</h1>
        <p className="mt-2 text-slate-400">
          Receba e responda whispers do WoW pelo navegador
        </p>
      </div>

      <div className="mt-10 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6 text-center sm:p-8">
        <div className="text-6xl">⬇️</div>
        <h2 className="mt-4 text-2xl font-bold">Baixar para Windows</h2>
        <p className="mt-2 text-sm text-slate-400">
          Aplicativo pronto pra usar — só baixar e abrir.
          <br />
          Sem instalar Python. Se precisar, dá para trocar API URL e Token dentro
          do app.
        </p>
        <a
          href="https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe"
          className="mt-6 inline-block w-full rounded-xl bg-emerald-500 px-6 py-4 text-lg font-bold text-slate-950 shadow-lg hover:bg-emerald-400 sm:w-auto sm:px-8"
        >
          📥 Baixar BakersWhisper.exe
        </a>
        <p className="mt-3 text-xs text-slate-500">Windows 10 ou 11 · ~30 MB</p>
      </div>

      <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        <b className="text-amber-300">⚠ Aviso do Windows Defender</b>
        <p className="mt-1 text-xs">
          Como o app não é assinado (assinatura custa $$$), o Windows pode
          mostrar um aviso azul dizendo &quot;<i>Windows protegeu o seu PC</i>&quot;.
          É normal. Clique em <b>&quot;Mais informações&quot;</b> e depois em{" "}
          <b>&quot;Executar assim mesmo&quot;</b>.
        </p>
      </div>

      <div className="mt-10">
        <h3 className="text-lg font-bold text-amber-300">Como usar</h3>
        <ol className="mt-4 space-y-4 text-sm text-slate-300">
          {[
            "Abra o WoW em cada janela que você quer monitorar (pode ter várias contas ao mesmo tempo).",
            "Em cada janela, digite /chatlog no chat do jogo e aperte Enter.",
            "Abra o BakersWhisper.exe. Ele vai listar todas as janelas do WoW detectadas.",
            "Confira a seção Servidor no app. Normalmente ela já vem preenchida.",
            "Digite o nome completo do personagem ao lado de cada janela, sempre no formato Nome-Reino.",
            "Clique em ▶ Iniciar e deixe o bridge rodando.",
          ].map((text, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-slate-950">
                {i + 1}
              </span>
              <div>{text}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-10 text-center">
        <Link href="/" className="text-sm text-amber-400 hover:underline">
          ← voltar ao chat
        </Link>
      </div>
    </div>
  );
}
