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
    - `whisperChatOpenDelayMs` default 800ms (chat aberto antes do paste).
    - `whisperChatSendDelayMs` default 500ms (antes de apertar Enter para enviar).
    - `whisperChatCloseDelayMs` default 600ms (antes de apertar Escape para fechar).
    - Delays aumentados drasticamente (1.5s entre abrir chat e colar comando) para evitar que o WoW "bugue" e abra outras janelas.
14. ✅ Sequência exata de envio v1.1.6 (ordem especificada pelo usuário):
    - 1️⃣ Focar janela → aguardar **2.0 segundos**
    - 2️⃣ Pressionar **Enter** → aguardar **1.0 segundo**
    - 3️⃣ Colar `/w nome-server` → aguardar **1.5 segundos** (chat abre aqui)
    - 4️⃣ Colar **mensagem** → aguardar **1.0 segundo**
    - 5️⃣ Pressionar **Enter** → aguardar **1.0 segundo**
    - 🔒 Fechar chat com **Escape** (opcional)
    - Separar o comando `/w` da mensagem garante que o WoW processa cada parte corretamente, evitando mensagens picotadas.
15. ✅ Chat em tempo real bidirecional v1.1.8:
    - `/api/conversations/bidirectional?charA=X&charB=Y` agora NORMALIZA direção pela perspectiva do viewer (`charA`): se B enviou para A, aparece como `incoming` quando A está vendo a conversa.
    - Dedup de espelhos: se existe A outgoing "salve" e B incoming "salve" em até 15s, vira um único balão (sem duplicar).
    - ChatApp cria conversas espelhadas no client quando `player` também é um personagem/janela conhecida: conversa B↔A aparece mesmo se só existe row A→B.
    - Polling de conversa aberta 500ms + global 1s.
    - Addon `WIMBridge.lua` agora captura também `CHAT_MSG_WHISPER_INFORM` (mensagens ENVIADAS pelo WIM/jogo) e ecoa `[WIMBRIDGE]<OWN:me><TO:target>body`.
    - Parser Python entende `<TO:...>` como `outgoing`, além de `<FROM:...>` como `incoming` e chatlog nativo `[W To]/[W From]`.
    - Resultado: comportamento de mensageiro normal — se taldoglaidon manda "salve" para madelina, o site de madelina mostra "salve" como mensagem recebida em tempo real.
16. ✅ Fix incoming externo v1.1.9:
    - Conversas agora são case-insensitive: WoW/WIM pode emitir `Juper-Azralon`/`Cbsies-Azralon` enquanto o site abriu `juper-azralon`/`cbsies-azralon`.
    - `/api/conversations/bidirectional` compara `lower(character/player)` e normaliza a direção pela perspectiva do viewer sem depender de caixa.
    - `/api/conversations/[character]/[player]` também compara case-insensitive (fallback e limpeza).
    - `/api/conversations` e `/api/characters` agrupam por `lower(...)` para não dividir conversa em maiúscula/minúscula.
    - `ChatApp` compara seleção/conversas/unread sem diferenciar caixa.
    - Bridge Python `_find_char_by_name` também procura personagem sem diferenciar caixa.
    - Testado: ingest `Juper-Azralon` + `Cbsies-Azralon` aparece em chat aberto como `juper-azralon`/`cbsies-azralon` com `direction=incoming`.
13. ✅ Delays ultra-conservadores v1.1.5:
    - `whisperFocusDelayMs` 800ms (antes de começar)
    - `whisperChatOpenDelayMs` 1500ms (CRÍTICO: tempo entre abrir chat e colar comando)
    - `whisperKeystrokeDelayMs` 100ms (entre cada caractere no fallback)
    - `whisperChatSendDelayMs` 800ms (antes de apertar Enter)
    - `whisperChatCloseDelayMs` 600ms (antes de apertar Escape)
    - `_send` reescrito com logging passo-a-passo para diagnóstico
    - Delay extra de 300ms após paste para garantir que o texto chegou ao campo
    - Verificação de comprimento do comando enviado
    - Fallback de digitação mais lento e robusto
12. ✅ Sincronização de histórico v1.1.4:
    - Bridge: `_sync_historical_messages` lê as últimas 100 linhas do WoWChatLog.txt quando inicia e envia pro site via `/api/sync` — captura mensagens de antes do bridge abrir.
    - Nova API `/api/sync` (POST para receber histórico do bridge, GET para buscar histórico no site).
    - Botão "🔄 Sincronizar" no header de cada conversa — força recarregar as últimas 50 mensagens do banco.
    - ApiClient do bridge: método `sync()` para enviar histórico.

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
