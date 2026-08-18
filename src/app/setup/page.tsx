import NavBar from "@/components/NavBar";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-3xl px-4 py-6 text-sm leading-6 text-slate-300">
        <h1 className="text-2xl font-semibold text-slate-100">Setup completo</h1>
        <p className="mt-2 text-slate-400">
          Passo a passo para conectar o Bakers Whisper ao World of Warcraft. Novidade da versão 2.6: leitura via
          text-to-speech + speech-to-text, para bypass total do <span className="font-mono">WoWChatLog.txt</span>.
        </p>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-100">1. Instalar o addon WIMBridge</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Baixe <span className="font-mono text-emerald-400">WIMBridge.zip</span> em{" "}
              <span className="font-mono">/download</span>.
            </li>
            <li>
              Extraia em <span className="font-mono">World of Warcraft/_retail_/Interface/AddOns/</span>:
              <pre className="mt-2 rounded-lg bg-slate-900 p-3 text-xs">{`AddOns/
  WIMBridge/
    WIMBridge.toc
    WIMBridge.lua`}</pre>
            </li>
            <li>Ative o addon na tela de personagens e entre no jogo.</li>
            <li>
              Confirme com <span className="font-mono">/wimbridge who</span> — deve mostrar v2.6.0.
            </li>
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-100">2. Instalar o bridge Python</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Instale Python 3.10+ (marque &ldquo;Add to PATH&rdquo;).</li>
            <li>
              Baixe <span className="font-mono">wim_bridge_gui.py</span>, <span className="font-mono">wim_bridge.py</span> e{" "}
              <span className="font-mono">requirements.txt</span> na mesma pasta.
            </li>
            <li>
              <span className="font-mono">pip install -r requirements.txt</span>
            </li>
            <li>
              <span className="font-mono">python wim_bridge_gui.py</span>
            </li>
          </ol>
        </section>

        <section className="mt-6 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4">
          <h2 className="text-lg font-semibold text-emerald-200">3. 🔊 Ativar leitura por voz (recomendado)</h2>
          <p className="mt-1 text-slate-300">
            Esse é o caminho novo que resolve o problema de mensagens só aparecerem quando você fecha o WoW. O addon
            fala cada whisper com nomes soletrados letra a letra, o bridge captura o áudio da placa de som
            (loopback WASAPI) e transcreve local com Whisper. Sem depender de flush de arquivo.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5">
            <li>
              Baixe também <span className="font-mono">wim_bridge_stt.py</span> e{" "}
              <span className="font-mono">requirements-stt.txt</span>.
            </li>
            <li>
              <span className="font-mono">pip install -r requirements-stt.txt</span>{" "}
              <span className="text-slate-400">(numpy, soundcard, faster-whisper — na primeira vez baixa ~500 MB do modelo &ldquo;small&rdquo;)</span>
            </li>
            <li>
              No GUI do bridge marque{" "}
              <span className="font-mono text-emerald-300">🔊 Leitura por TTS→STT</span> e clique{" "}
              <span className="font-mono">Salvar config</span> + <span className="font-mono">▶ Iniciar</span>.
            </li>
            <li>
              No WoW rode <span className="font-mono">/wimbridge tts on</span> (default é ligado) e{" "}
              <span className="font-mono">/wimbridge tts test</span> para confirmar que a placa de som fala uma frase de teste.
            </li>
            <li>
              Peça para alguém te sussurrar. O addon falará algo como{" "}
              <span className="font-mono text-emerald-300">
                &ldquo;bridge from C B S I E S dash A Z R A L O N says hello end&rdquo;
              </span>
              . Deve aparecer no site em ~1 s.
            </li>
          </ol>
          <div className="mt-3 rounded-lg bg-slate-950/60 p-3 text-xs text-slate-400">
            <div className="font-medium text-slate-300">Dicas de qualidade</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Deixe o volume do WoW audível (o loopback captura o que a placa toca, mesmo com fone).</li>
              <li>Use modelo <span className="font-mono">small</span> em CPU normal. Se tiver GPU NVIDIA, mude para <span className="font-mono">device=cuda</span>.</li>
              <li>
                Se ficar cortando fala longa, aumente <span className="font-mono">silence_ms</span> e{" "}
                <span className="font-mono">max_utter_ms</span> no <span className="font-mono">config.ini</span>.
              </li>
              <li>
                Se pegar barulho demais, aumente <span className="font-mono">rms_threshold</span> para 0.015.
              </li>
              <li>
                Ajuste a voz no jogo: <span className="font-mono">/wimbridge tts voices</span> e{" "}
                <span className="font-mono">/wimbridge tts rate 4</span>.
              </li>
            </ul>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-100">4. Bônus: ler no navegador</h2>
          <p className="mt-1">
            No chat, ligue <span className="font-mono">🔊 Ler em voz alta</span> para que o próprio site fale as
            mensagens que chegam usando o TTS do navegador. Prático para deixar aberto em outro monitor.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-100">5. Comandos do addon</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-mono">
            <li>/wimbridge who — versão e personagem</li>
            <li>/wimbridge test — dispara relay + fala de teste (incoming)</li>
            <li>/wimbridge testout — teste outgoing</li>
            <li>/wimbridge log — garante /chatlog ligado</li>
            <li>/wimbridge flush — força multi-flush do chatlog</li>
            <li>/wimbridge channel — status do canal relay</li>
            <li>/wimbridge tts on|off|test|voices|rate N|volume N</li>
            <li>/wimbridge chan on|off — liga/desliga rota do canal relay</li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-100">6. Debug</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Bridge mostra <span className="font-mono">🔊← [Char] Player: msg</span> quando STT transcreveu com sucesso.</li>
            <li>Se aparecer <span className="font-mono">[stt] fala não bateu com padrão bridge: «...»</span>, ajuste a voz do addon (mais devagar) ou troque o modelo Whisper para <span className="font-mono">medium</span>.</li>
            <li>Se aparecer <span className="font-mono">🔎 linha com cara de whisper não parseada</span>, é a rota antiga do chatlog — o parser de texto pode precisar de regex extra.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
