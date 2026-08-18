# 🥐 Bakers Whisper — Relatório completo para próxima IA

**Última atualização deste relatório:** 2026-08-13  
**Projeto original:** `github.com/geleia328/wimmsg`  
**Nome público:** Bakers Whisper  
**Stack:** Next.js App Router + TypeScript + Tailwind CSS + Drizzle ORM + PostgreSQL + Python bridge + addon Lua para World of Warcraft  
**Objetivo:** painel estilo mensageiro/WhatsApp Web para receber e responder whispers do WoW de múltiplas janelas/personagens ao mesmo tempo.

---

## 1. Estado atual esperado do projeto

O projeto deve conter:

```txt
src/
  app/
    page.tsx
    layout.tsx
    globals.css
    accounts/page.tsx
    download/page.tsx
    gse/page.tsx
    settings/page.tsx
    setup/page.tsx
    report/route.ts
    api/
      health/route.ts
      ingest/route.ts
      sync/route.ts
      queue/route.ts
      queue/[id]/ack/route.ts
      conversations/route.ts
      conversations/[character]/[player]/route.ts
      conversations/bidirectional/route.ts
      characters/route.ts
      incoming/recent/route.ts
      status/route.ts
      status/scan/route.ts
      control/route.ts
      gse/route.ts
      gse/[character]/route.ts
      download/[file]/route.ts
      admin/settings/route.ts
      admin/init-db/route.ts
      admin/vercel-env/route.ts
  components/
    ChatApp.tsx
    AccountsView.tsx
    GseView.tsx
    SettingsView.tsx
    useNotifications.ts
  db/
    index.ts
    schema.ts
  lib/
    auth.ts
public/downloads/
  wim_bridge_gui.py
  wim_bridge.py
  requirements.txt
  config.example.ini
  WIMBridge.zip
  WIMBridge/
    WIMBridge.lua
    WIMBridge.toc
docs/
  RELATORIO_PARA_PROXIMA_IA.md
  HANDOFF_PROMPT.md
  RELATORIO.md
  RELATORIO_COMPLETO.md
  BAKERS_WHISPER_COMPLETE_HANDOFF.md
```

---

## 2. Variáveis de ambiente

Arquivo `.env` local esperado:

```txt
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
BRIDGE_TOKEN=
```

Produção/Vercel:

```txt
DATABASE_URL=<Postgres/Neon pooled connection string>
BRIDGE_TOKEN=<segredo compartilhado com o bridge>
ADMIN_TOKEN=<opcional; se ausente usa BRIDGE_TOKEN para admin>
```

Regras:

- `DATABASE_URL` é obrigatória para Drizzle/Postgres.
- `BRIDGE_TOKEN` protege endpoints do bridge quando configurado.
- Em dev, se token estiver vazio, endpoints do bridge permitem acesso.
- Nunca hardcodar segredos.

---

## 3. Banco de dados — Drizzle schema

Arquivo: `src/db/schema.ts`

Tabelas principais:

### `messages`

Campos:

- `id serial primary key`
- `character varchar(128)` — personagem/janela própria do usuário.
- `player varchar(128)` — outra ponta da conversa.
- `direction varchar(16)` — `incoming` ou `outgoing`.
- `body text`
- `status varchar(16)` — `received`, `pending`, `sent`, `failed`.
- `externalId varchar(128)` unique — idempotência do bridge.
- `error text`
- `createdAt timestamptz default now()`
- `sentAt timestamptz`

Índices:

- player
- character
- createdAt
- status
- unique externalId

### `client_windows`

Inventário das janelas WoW detectadas pelo bridge.

Campos:

- `id`
- `character`
- `windowTitle`
- `pid`
- `hwnd`
- `foreground`
- `matched`
- `slot`
- `realm`
- `lastSeen`

### `gse_state`

Estado do GSE por personagem.

Campos:

- `character primary key`
- `running yes/no`
- `keybind`
- `intervalMs`
- `updatedAt`

### `app_settings`

Configurações editáveis no app.

Chaves padrão atuais:

```ts
bridge_reader_enabled: "yes"
gse_master_enabled: "no"
whisper_focus_delay_ms: "2000"
whisper_after_send_delay_ms: "1000"
whisper_chat_open_delay_ms: "1000"
whisper_keystroke_delay_ms: "100"
whisper_chat_send_delay_ms: "1000"
whisper_close_chat_enabled: "yes"
whisper_chat_close_delay_ms: "500"
queue_poll_ms: "1500"
```

Observação: os delays no site existem por compatibilidade/configuração, mas o bridge atual, na sequência de envio principal, usa uma sequência fixa especificada pelo usuário.

---

## 4. Fluxo de chat desejado

O usuário quer comportamento de mensageiro normal:

- Se `cbsies-azralon` envia mensagem para `juper-azralon`, o site de `juper-azralon` deve mostrar essa mensagem como recebida no chat com `cbsies-azralon`.
- Se o usuário responde pelo site, o bridge deve enviar na janela WoW correta.
- Conversas entre dois personagens do próprio usuário também devem funcionar como chat bidirecional.

### Case-insensitive obrigatório

Nomes vindos do WoW/WIM podem vir assim:

```txt
Juper-Azralon
Cbsies-Azralon
```

E o usuário pode abrir no site assim:

```txt
juper-azralon
cbsies-azralon
```

Todas as comparações devem ser case-insensitive.

Rotas já adaptadas:

- `/api/conversations/bidirectional`
- `/api/conversations/[character]/[player]`
- `/api/conversations`
- `/api/characters`

No `ChatApp`, comparações de seleção, filtro, unread e conversa usam helper `sameName()`.

---

## 5. API de conversa

### `GET /api/conversations`

Lista conversas agrupando por `lower(character), lower(player)` para evitar duplicação por caixa.

Retorna:

```json
{
  "conversations": [
    {
      "character": "juper-azralon",
      "player": "cbsies-azralon",
      "lastAt": "...",
      "lastBody": "...",
      "lastDirection": "incoming",
      "incomingCount": 1,
      "totalCount": 1
    }
  ]
}
```

### `GET /api/conversations/[character]/[player]`

Busca mensagens desse par com comparação case-insensitive.

### `POST /api/conversations/[character]/[player]`

Cria mensagem outgoing `pending` para fila do bridge.

### `DELETE /api/conversations/[character]/[player]`

Limpa conversa case-insensitive.

### `GET /api/conversations/bidirectional?charA=X&charB=Y`

Rota central do comportamento de mensageiro.

- Busca mensagens dos dois lados.
- Compara `lower(character/player)`.
- Normaliza direção pela perspectiva de `charA`.
- Remove duplicatas espelhadas dentro de janela de 15s.

Exemplo:

Registro bruto:

```txt
character=Juper-Azralon
player=Cbsies-Azralon
direction=incoming
body=salve
```

Abrindo:

```txt
charA=juper-azralon
charB=cbsies-azralon
```

Retorna:

```txt
direction=incoming
body=salve
```

---

## 6. API de ingestão

### `POST /api/ingest`

Recebe mensagens do Python bridge.

Aceita array:

```json
{
  "messages": [
    {
      "externalId": "...",
      "character": "Juper-Azralon",
      "player": "Cbsies-Azralon",
      "body": "mensagem",
      "direction": "incoming",
      "status": "received",
      "receivedAt": "..."
    }
  ]
}
```

O servidor possui defesa extra: se bridge antigo mandar algo assim:

```json
{
  "character": "juper-azralon",
  "player": "Juper-Azralon",
  "body": "WIMRELAY<OWN:Juper-Azralon><FROM:Cbsies-Azralon><TS:...>Teste"
}
```

O `/api/ingest` extrai e corrige antes de salvar:

```txt
character=Juper-Azralon
player=Cbsies-Azralon
body=Teste
direction=incoming
```

Também entende:

- `[WIMBRIDGE]<OWN:...><FROM:...>...`
- `[WIMBRIDGE]<OWN:...><TO:...>...`
- `WIMRELAY<OWN:...><FROM:...><TS:...>...`
- `WIMRELAY<OWN:...><TO:...><TS:...>...`

### `POST /api/sync`

Recebe histórico do bridge. Possui parser defensivo igual ao `/api/ingest`.

### `GET /api/sync?character=X&player=Y&limit=50`

Busca histórico salvo no site.

---

## 7. ChatApp

Arquivo: `src/components/ChatApp.tsx`

Características atuais:

- Layout responsivo estilo WhatsApp/mensageiro.
- Mobile: lista e conversa funcionam como drawer full-screen.
- Desktop/tablet: sidebar + painel de mensagens.
- `POLL_MS = 1000` global.
- Conversa aberta faz polling bidirecional a cada `500ms`.
- Usa `/api/conversations/bidirectional` para exibir chat.
- Badge `!` em conversas com mensagens não lidas.
- Notificação sonora/navegador via `useNotifications`.
- Botão `🗑 Limpar` apaga conversa.
- Botão `🔄 Sincronizar` busca últimas mensagens salvas.

Cuidado: se mudar lógica de seleção, manter `sameName()` para evitar bug por caixa.

---

## 8. GSE

Arquivo: `src/components/GseView.tsx`

Funcionalidades:

- Master GSE on/off.
- Leitor de janela/whisper on/off.
- Delay controls.
- Fechar chat após enviar.
- Tabela de personagens com:
  - keybind
  - intervalo
  - running/stop
  - remover personagem
- Alterações de keybind/intervalo não são mais salvas em `onBlur`; usa botão `Salvar alterações dos personagens`.
- `charDirtyRef` impede que polling de 2s sobrescreva valores digitados antes de salvar.

---

## 9. Sequência de envio atual do bridge

Arquivo: `public/downloads/wim_bridge_gui.py`

Usuário especificou a sequência exata:

```txt
1. Focar janela e aguardar 2 segundos.
2. Pressionar Enter e aguardar 1 segundo.
3. Colar /w nome-server e aguardar 1 segundo.
4. Pressionar Espaço e aguardar 1 segundo.
5. Colar mensagem e aguardar 1 segundo.
6. Pressionar Enter e aguardar 1 segundo.
7. Fechar chat com Escape se habilitado.
```

Essa sequência existe porque WIM precisa do espaço após `/w nome-realm` para abrir/preparar o chat de whisper.

Observação: envio usa clipboard/paste quando possível para evitar mensagens picadas. Fallback usa digitação lenta.

---

## 10. Python bridge

Arquivo principal: `public/downloads/wim_bridge_gui.py`

Responsabilidades:

- Detectar janelas WoW via Win32/psutil.
- Atribuir slots `wow1`, `wow2`, etc.
- Ler `WoWChatLog.txt`.
- Parsear mensagens reais do WoW/WIM/addon.
- POST `/api/ingest`.
- Poll `/api/queue` e enviar replies no jogo.
- POST `/api/queue/[id]/ack`.
- POST `/api/status/scan`.
- Poll `/api/control`.
- Poll `/api/gse` e controlar spammers.

### Parser atual aceita

- `[WIMBRIDGE]<OWN:...><FROM:...>body`
- `[WIMBRIDGE]<OWN:...><TO:...>body`
- `WIMRELAY<OWN:...><FROM:...><TS:...>body`
- `WIMRELAY<OWN:...><TO:...><TS:...>body`
- `[W From] [Name-Realm]: body`
- `[W To] [Name-Realm]: body`
- `[De] [Name-Realm]: body`
- `[Para] [Name-Realm]: body`
- `Name-Realm sussurra: body`
- `Name-Realm whispers: body`
- `De Name-Realm: body`
- `Para Name-Realm: body`

### Diagnóstico

Se o bridge vê linha com cara de whisper mas não parseia, loga:

```txt
🔎 linha com cara de whisper não parseada: ...
```

Se aparecer isso, a próxima IA deve adaptar regex para o formato real.

---

## 11. Addon WIMBridge atual

Arquivos:

```txt
public/downloads/WIMBridge/WIMBridge.lua
public/downloads/WIMBridge/WIMBridge.toc
public/downloads/WIMBridge.zip
```

Versão atual esperada: `2.5.0`

### Por que usa canal relay privado

`DEFAULT_CHAT_FRAME:AddMessage()` nem sempre é escrito em `WoWChatLog.txt`. Para forçar o log, o addon entra em um canal privado aleatório e envia linhas compactas:

```txt
WIMRELAY<OWN:Juper-Azralon><FROM:Cbsies-Azralon><TS:...>mensagem
WIMRELAY<OWN:Juper-Azralon><TO:Cbsies-Azralon><TS:...>mensagem
```

O WoW grava mensagens reais de canal no `WoWChatLog.txt`, por isso o bridge consegue ler.

### Problema descoberto

Em alguns clientes, o `WoWChatLog.txt` só atualiza quando fecha o WoW. Para contornar, o addon 2.5.0 faz multi-flush atrasado:

```txt
1.5s depois do relay
3.0s depois do relay
5.0s depois do relay
```

Cada flush faz:

```lua
LoggingChat(false)
aguarda 0.35s
LoggingChat(true)
```

Comandos addon:

```txt
/wimbridge who
/wimbridge test
/wimbridge testout
/wimbridge log
/wimbridge flush
/wimbridge channel
```

Ao instalar, estrutura obrigatória:

```txt
World of Warcraft\_retail_\Interface\AddOns\WIMBridge\WIMBridge.toc
World of Warcraft\_retail_\Interface\AddOns\WIMBridge\WIMBridge.lua
```

Se estiver em Classic, trocar `_retail_` pelo cliente correto.

---

## 12. Fluxo real esperado para mensagens recebidas

```txt
Amigo envia whisper via WoW/WIM
→ addon WIMBridge captura CHAT_MSG_WHISPER
→ addon envia WIMRELAY em canal privado
→ addon faz multi-flush do /chatlog
→ WoWChatLog.txt atualiza
→ bridge tail_file lê a linha
→ parse_whisper extrai OWN/FROM/BODY
→ bridge POST /api/ingest
→ site salva messages
→ ChatApp polling bidirecional 500ms atualiza conversa
```

Se só aparece no bridge quando fecha WoW, o problema é flush do arquivo. A solução atual é addon 2.5.0 com multi-flush.

---

## 13. Fluxo real esperado para envio pelo site

```txt
Usuário digita no site
→ POST /api/conversations/[character]/[player]
→ mensagem status=pending
→ bridge GET /api/queue
→ bridge encontra janela character
→ pausa todos spammers GSE
→ executa sequência de envio no WoW
→ ack sent
→ chat fecha com ESC
→ site mostra status sent
```

---

## 14. Responsividade

Projeto já adaptado para:

- celular
- tablet
- iPad
- notebook
- desktop

Pontos:

- `layout.tsx` usa viewport com `viewportFit: "cover"`.
- `globals.css` usa safe-area inset.
- Chat mobile usa drawer.
- Tables Accounts/GSE usam scroll horizontal.
- GSE grid responsivo.

---

## 15. Validação obrigatória

Sempre rodar antes de finalizar:

```bash
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
```

Depois chamar `build_and_start`.

Se mudar schema, rodar também:

```bash
npx drizzle-kit push
```

---

## 16. Bugs históricos já tratados

1. Mensagens picadas no WoW.
   - Solução: sequência lenta + clipboard/paste + espaço para WIM.
2. GSE continuava apertando tecla com master OFF.
   - Solução: control sync para spammers a cada ciclo enquanto master off.
3. Mensagens recebidas não apareciam no site.
   - Solução: addon relay + parser WIMRELAY + case-insensitive + bidirectional route.
4. Histórico aparecia só ao fechar WoW.
   - Solução atual: addon 2.5.0 multi-flush.
5. Nome com maiúscula/minúscula dividia conversa.
   - Solução: lower/group/case-insensitive.
6. Intervalo GSE voltava sozinho.
   - Solução: `charDirtyRef`.
7. `WIMRELAY` chegava no corpo da mensagem e salvava errado.
   - Solução: parser defensivo no `/api/ingest` e `/api/sync`.

---

## 17. Ponto crítico para próxima IA

Se o usuário ainda disser que só recebe mensagem ao fechar o WoW, pedir o seguinte:

1. Confirmar addon versão 2.5.0:

```txt
/wimbridge who
```

2. Confirmar canal relay:

```txt
/wimbridge channel
```

3. Testar flush manual:

```txt
/wimbridge test
/wimbridge flush
```

4. Olhar log do bridge:

- Se aparecer `← [Juper-Azralon] Cbsies-Azralon: ...`, site deve receber.
- Se aparecer `🔎 linha com cara de whisper não parseada`, adaptar parser.
- Se não aparecer nada até fechar WoW, o WoW não está flushando `WoWChatLog.txt`. Próxima alternativa real seria criar um canal relay mais ruidoso/periódico ou abandonar `WoWChatLog.txt` e capturar de outro modo externo.

Possíveis alternativas futuras:

- Addon enviar várias mensagens relay redundantes com ids únicos para forçar log.
- Bridge ler SavedVariables apenas após `/reload` não serve para tempo real.
- OCR/memória/UI scraping é mais invasivo e não recomendado.
- Criar companion local lendo chat por outro meio exigiria integração fora da sandbox.

---

## 18. Arquivos que o usuário deve atualizar no PC

Quando houver mudança no bridge Python:

```txt
BakersWhisper.exe
```

Quando houver mudança no addon:

```txt
WIMBridge.zip
```

Versão atual do addon no relatório: `2.5.0`.

O parser do bridge não é instalado separado; vem dentro do `.exe`.

---

## 19. Status final deste relatório

No sandbox atual:

- `next typegen`: passou.
- `tsc --noEmit`: passou.
- `npm run build`: passou.
- `build_and_start`: passou.
- Addon ZIP publicado via `/api/download/WIMBridge.zip`.
- `.toc` publicado versão 2.5.0.
- Parser Python validado com `py_compile`.
