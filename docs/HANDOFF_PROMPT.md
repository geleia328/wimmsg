# HANDOFF PROMPT PARA NOVO CHAT — BAKERS WHISPER

Copie e cole este bloco inteiro no próximo chat onde você vai continuar o desenvolvimento.

---

Olá! Você vai continuar um projeto existente chamado **Bakers Whisper** — painel web + app Windows para WoW multi-conta.

**Instruções para você (IA):**
1. Leia o relatório completo em `docs/RELATORIO_COMPLETO.md` que está anexado neste projeto (ou vou colar abaixo).
2. Recrie o projeto IDÊNTICO: mantenha Tech stack, estrutura de pastas, nomes de arquivos, endpoints, schema Drizzle, lógica Python, addon Lua, workflow GitHub Actions exatamente iguais.
3. Não faça simplificações. Implemente todas as features descritas: chat, accounts, gse, settings, download, setup, report, ingest, queue, scan, control, admin init-db, vercel-env, download/[file], notifications sonoras, realm mismatch warning, slot wowN, renomeação automática, persistência por slot, botão salvar personagens, server settings editáveis no app, master GSE, reader toggle separado, delays configuráveis, mensagens pending se janela fechada.
4. Use Next.js 16 App Router + Tailwind + Drizzle + pg. Valide no final com `npx next typegen`, `tsc --noEmit`, `npm run build`, `build_and_start`.
5. O repositório é https://github.com/geleia328/wimmsg e o site é https://wimmsg-lntm.vercel.app . O nome do projeto é Bakers Whisper v1.0.7.
6. ✅ Responsividade mobile concluída na v1.0.8: ChatApp com drawer (lista ↔ chat + botão voltar, `h-dvh`, header com nav rolável e dropdown de notificações sem clip), AccountsView e GseView com tabelas `overflow-x-auto`, SettingsView/Download/Setup com empilhamento responsivo.
7. ✅ Exclusão de chat concluída na v1.0.9: `DELETE /api/messages/[id]` apaga mensagem individual; `DELETE /api/conversations/[character]/[player]` limpa a conversa inteira; ChatApp tem lixeira em cada balão e botão `🗑 Limpar` no cabeçalho da conversa, com confirmação e remoção automática da fila se a mensagem estava pending.
8. ✅ Bug fixes v1.1.0:
   - GSE: intervalo agora salva via botão "💾 Salvar alterações dos personagens" (não mais onBlur).
   - GSE: remoção de personagem via `DELETE /api/gse/[character]` com botão ✕ em cada linha.
   - GSE: 6 controles de timing: abrir chat, foco, digitar, enviar, pós-envio, poll fila.
   - Chat: layout mobile redesenhado estilo WhatsApp/Telegram com drawer full-screen.
   - Chat: badge de "!" amarelo em conversas com mensagens novas não lidas.
   - Chat: auto-refresh instantâneo quando chega whisper na conversa atualmente aberta (sem esperar polling de 2s).
   - Chat: botão ➤ de envio quadrado, espaçamento e tipografia mobile otimizados.
   - Responsividade total para celular, iPad, tablet, notebook e desktop:
     * layout.tsx: Viewport export com `viewport-fit=cover`, `theme-color`, `maximum-scale=1`.
     * globals.css: safe-area-inset em body para notch devices.
     * ChatApp: sidebar `md:w-80 lg:w-96`, nav scroll horizontal, header compacto.
     * AccountsView: `min-h-dvh`, cards menores em mobile, tabela scroll hint gradiente.
     * GseView: `min-h-dvh`, tabela scroll hint, grid timing responsivo `sm:grid-cols-2 lg:grid-cols-3`.
     * SettingsView: sections com padding responsivo `p-4 sm:p-5`, títulos `text-base sm:text-lg`.
     * Download/Setup: paddings e títulos responsivos.
9. ✅ Bug fixes GSE v1.1.1:
   - `charDirtyRef`: o poll de 2s não sobrescreve mais edições não salvas de keybind/intervalo dos personagens (antes o `setStates(map)` do refresh apagava os rascunhos).
   - `updateControls` agora retorna boolean; `saveDelays` só limpa o flag dirty em caso de sucesso (antes um POST 401/erro limpava o dirty e o poll revertia os valores).
   - Alertas claros para 401 (instruções de token admin em /settings) e erros de conexão, com valores preservados.
   - `saveAllCharChanges` checa `res.ok` por personagem, limpa o dirty ANTES do refresh para sincronizar os valores salvos.
   - Campo typing com `step={1}` e `inputMode="numeric"` para digitação fácil no mobile.
10. ✅ Pipeline de whispers bidirecional v1.1.2 (fix crítico — mensagens recebidas se perdiam):
   - Bridge (`wim_bridge_gui.py`):
     * `DEFAULT_CONTROLS` agora inclui `whisperChatOpenDelayMs`, `whisperKeystrokeDelayMs`, `whisperChatSendDelayMs` (antes o `_control_syncer` filtrava e IGNORAVA os delays configurados no site).
     * `_send` implementa a sequência: foco → Enter (abrir chat) → openDelay → digitar com keystrokeDelay → sendDelay → Enter (enviar) → afterDelay.
     * Parser agora lê o chatlog NATIVO do WoW: `[W From]` → incoming, `[W To]` → outgoing (funciona SEM o addon, só com /chatlog). Timestamp tolerante (com/sem ms).
     * `[W To]` captura respostas digitadas dentro do jogo → nunca mais se perdem.
     * Dedup `recent_whispers` (janela 15s): addon echo + linha nativa do mesmo whisper não duplicam; mensagens digitadas pelo próprio bridge não são re-ingestadas.
     * Diagnóstico: se 30+ linhas do log passarem sem nenhum whisper parseado por 3min, loga dica sobre /chatlog e addon.
   - Site:
     * `/api/ingest` aceita `direction` ("incoming"|"outgoing") e `status` por mensagem.
     * `useNotifications` retorna objeto estável via useMemo (o poller de incoming não reinicia a cada render).
     * Removido bug no `refreshTop` que marcava TODAS as conversas como não lidas quando a aba ficava oculta (quem marca é só o poller de `/api/incoming/recent`, corretamente por mensagem nova).
11. ✅ Envio robusto + fechar chat v1.1.3:
    - Mensagem "picada" (testando → ando) resolvida: envio usa PASTE atômico via clipboard (win32clipboard + Ctrl+V) — a mensagem inteira chega de uma vez. Fallback: digitação char-a-char com keystrokeDelay.
    - `_send` pausa TODOS os spammers GSE durante o envio (antes só o do personagem alvo) — teclas simuladas nunca colidem com PostMessage do GSE.
    - Fechar chat: novos controles `whisperCloseChatEnabled` (default yes) e `whisperChatCloseDelayMs` (default 200). Após enviar, o bridge pressiona ESC e fecha o campo de chat do jogo. A próxima mensagem da fila reabre o chat sozinha (Enter → paste /w player → Enter → ESC), então dá para conversar depois com fulano/lucas mesmo com o chat fechado.
    - GSE master OFF: corrida corrigida — `_control_syncer` para TODOS os spammers a CADA ciclo (0.5s) enquanto master estiver OFF, mesmo se `_gse_syncer` tentar recriar com controles obsoletos.
    - `whisperChatOpenDelayMs` default 300ms (chat aberto antes do paste).
12. ✅ Tempos de envio mais lentos v1.1.4 (chat do jogo não buga mais):
    - Novos defaults: foco 800ms, abrir chat 600ms, typing 80ms, enviar (após colar) 500ms, fechar chat (ESC) 400ms, pós-envio 800ms.
    - PISOS mínimos no bridge `_send`: foco/abrir/enviar/fechar nunca ficam abaixo de 0.3s (typing 0.02s) mesmo se configurados para menos — o jogo sempre termina a ação anterior antes da próxima tecla.
    - Faixas do site ampliadas: abrir/enviar/fechar até 5000ms, foco/pós até 10000ms, typing até 1000ms; mínimos 200ms.
    - Atualizados: schema, /api/control (GET+POST), seed init-db, GseView (defaults + inputs) e DEFAULT_CONTROLS do bridge.
13. ✅ Histórico completo do chat v1.1.5 (extrai o que já estava escrito no jogo):
    - REPLAY do WoWChatLog.txt: ao abrir uma janela, o bridge relê os últimos ~2MB do log e ingere TODOS os whispers já escritos (recebidos via addon/native, enviados no jogo via [W To]) com `receivedAt` real — a conversa aparece no site em ordem cronológica. Se o arquivo tem linhas [WIMBRIDGE], as nativas [W From] são puladas (o addon já cobre) para não duplicar.
    - ADDON: echo agora inclui `<TS:epoch>` (idempotência), guarda whispers recebidos em SavedVariables (WIMBridgeDB, máx 300) e o comando `/wimbridge dump` re-imprime o histórico com os MESMOS TS. O bridge roda o dump automaticamente uma vez por janela/sessão (`_history_syncer` + `_type_command`), recuperando whispers que aconteceram antes do /chatlog ou do bridge abrir.
    - `make_ext_id` determinístico (hash character|player|body|ts): replay, dump e rotação de log são idempotentes — nunca duplicam no site.
    - Sent-history persistido (`%APPDATA%/BakersWhisper/sent_history.json`): durante replay, [W To] de mensagens que o PRÓPRIO bridge enviou são pulados (site já tem essas linhas do ack da fila).
    - `_canonical_char` normaliza o OWN do addon (case-insensitive) — conversas não se dividem por variação de maiúsculas/minúsculas.
    - `_type_command` refatorado: mesma rotina segura (foco→Enter→paste→Enter→ESC) usada para whispers E para o dump.
14. ✅ Envio lento e seguro v1.1.6 (fim da mensagem picada e do jogo bugando):
    - CAUSA do "jogo buga": o bridge pressionava ESC após enviar, mas o WoW JÁ fecha o campo de chat sozinho — ESC com chat fechado ABRE O MENU do jogo. Agora `whisperCloseChatEnabled` é default OFF (toggle com aviso no site).
    - Nova sequência do `_type_command`: foco (1000ms) → Enter → **2000ms esperando o chat abrir 100%** → Ctrl+A (limpa texto residual) → espera 250ms → cola o comando inteiro (clipboard) → **800ms** antes do Enter de envio → pós-envio 800ms.
    - Pisos no bridge: foco ≥0.5s, abrir chat ≥0.5s, enviar ≥0.4s, typing ≥0.05s/tecla — impossível digitar antes do campo estar pronto.
    - Fallback de digitação prefere pydirectinput (melhor para jogos) com 100ms/tecla.
    - Site: label explicativo "se a mensagem chega picada, AUMENTE este valor"; faixas até 10000ms para abrir/enviar/foco/pós.
15. ✅ ORDEM OFICIAL DE ENVIO v1.1.7 (definida pelo usuário):
    - Sequência em duas etapas: foco (2000ms) → Enter → 1000ms → colar `/w Nome-Server` → **1500ms** (jogo abre o modo whisper) → colar a mensagem → 1000ms → Enter envia → 1000ms pós-envio.
    - Novo controle `whisperWReadyDelayMs` (whisper_w_ready_delay_ms, default 1500) — o tempo entre colar o /w e colar a mensagem.
    - `_send` reescrito com a ordem exata (Ctrl+A de segurança só no início); defaults atualizados em schema, /api/control, init-db, GseView e DEFAULT_CONTROLS do bridge.
16. ✅ FIX ESPAÇO v1.1.8 — o WoW exige espaço após /w Nome:
    - Nova ordem: foco (2s) → Enter → 1s → colar `/w Nome-Server` → 1s → **press_key("space")** → 1s → colar mensagem → 1s → Enter → 1s.
    - Novo controle `whisperSpaceDelayMs` (whisper_space_delay_ms, default 1000); `whisperWReadyDelayMs` agora é "antes do espaço" (default 1000).
    - Atualizados: schema, /api/control, init-db, GseView (labels + campo novo) e bridge (_send + DEFAULT_CONTROLS).
17. ✅ Chat em tempo real v1.1.9 (espelhamento entre contas próprias):
    - POST /api/conversations/[character]/[player]: se o DESTINATÁRIO é outro personagem seu (client_windows matched OU gse_state OU character em messages), o site insere IMEDIATAMENTE a linha incoming espelhada na conversa do destinatário (`externalId` = `mirror-<outId>`, `mirrored: true` na resposta) — sem esperar o bridge ler o log.
    - Dedupe no /api/ingest: linhas incoming que batem com um `mirror-*` dos últimos 120s (mesmo character/player/body) são ignoradas — o echo do jogo NÃO duplica a mensagem espelhada (testado: inserted 0).
    - ChatApp: POLL_MS 2000 → 1000 (lista, conversa aberta e poller de notificações) + refresh imediato no `focus`/`visibilitychange` (mensagens chegadas enquanto a aba estava oculta aparecem na hora).
18. ✅ Messenger bidirecional definitivo v1.1.10:
    - Criado `src/lib/ownCharacters.ts` com descoberta centralizada de personagens próprios usando TODOS os `client_windows.character` não vazios (sem exigir matched=yes), `gse_state` e `messages.character`.
    - `/api/conversations` usa o helper: envio do site A→B cria outgoing em A/B + incoming imediato em B/A, mesmo durante rescan (`matched=no`). Retorna `mirrored: true` e `mirrorReason` para diagnóstico.
    - `/api/ingest` também espelha `direction=outgoing` digitado DIRETAMENTE NO JOGO: A→B insere outgoing em A/B e incoming em B/A na mesma requisição. Assim não depende de o log do destinatário ser lido a tempo.
    - Echo `[W From]` posterior é deduplicado; o mesmo externalId pode ser reprocessado sem duplicar. Testado: site→jogo, jogo→site, matched=no, echo posterior e reenvio idempotente.
    - `/api/characters` inclui personagens conhecidos pelo bridge mesmo sem mensagens, mantendo as duas contas disponíveis desde o início.

**Relatório completo (cole aqui):**

```
--- COLE AQUI O CONTEÚDO INTEIRO DE docs/RELATORIO_COMPLETO.md ---
```

Se você não tiver o arquivo, use esta versão resumida: repositório https://github.com/geleia328/wimmsg tem todo código. Site wimmsg-lntm.vercel.app . Usar Neon pooled connection string DATABASE_URL + BRIDGE_TOKEN. Python GUI em public/downloads/wim_bridge_gui.py com detecção EnumWindows, slot assign, rename SetWindowText, tail WoWChatLog.txt, parse [WIMBRIDGE]<OWN><FROM>, GSE spammer PostMessage, control sync, health/auth check.

**Tarefas imediatas após recriar:**
- ✅ Garantir que relatório em /report serve docs/RELATORIO_COMPLETO.md (já implementado no route.ts)
- ✅ Tornar site 100% responsivo mobile (ChatApp drawer, Accounts table scroll, GSE table scroll, etc.)
- ✅ Validar build (next typegen + tsc + npm run build + build_and_start)

**Sugestões para o próximo chat (v1.1.0):**
- Testar em celular real e ajustar qualquer overflow restante.
- Considerar PWA (manifest + service worker) para instalar no celular.
- Suporte a múltiplos servidores (login) ou relatório de uso diário.

Obrigado!
