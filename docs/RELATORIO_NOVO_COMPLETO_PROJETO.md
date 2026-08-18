# RELATÓRIO COMPLETO DO PROJETO BAKERS WHISPER

## 1. Objetivo do sistema

Este projeto é um painel web para monitorar e responder whispers do World of Warcraft em múltiplas janelas ao mesmo tempo, unindo:

- frontend em Next.js para visualização e controle
- backend em API Routes do Next.js
- banco PostgreSQL via Drizzle ORM
- bridge em Python rodando no PC do usuário
- addon Lua para WoW (`WIMBridge`) que envia o conteúdo dos whispers para o bridge

A arquitetura do projeto foi pensada para funcionar como um painel tipo WhatsApp, mas para whispers do WoW, com dezenas de janelas simultâneas do mesmo cliente, permitindo:

- captar whispers recebidos em qualquer janela aberta
- agregar tudo em um único painel web
- mostrar conversas por personagem e jogador
- responder manualmente no site
- enviar a resposta de volta para a janela correta do WoW
- controlar GSE (Gnome Sequencer Enhanced) por personagem
- monitorar janelas ativas, online/offline e foco

A lógica principal é: o script Python fica na máquina do usuário, detecta as janelas do WoW, monitoria logs de chat, envia dados para a API, e também lê a fila de mensagens pendentes para digitar `/w <player> <mensagem>` na janela certa.

---

## 2. Visão geral da arquitetura

O sistema possui 4 camadas principais:

1. Frontend web
   - aplicação Next.js
   - rota `/` para o chat principal
   - páginas `/accounts`, `/gse`, `/settings`, `/download`, `/setup`
   - componente principal: `ChatApp.tsx`

2. Backend Web API
   - em `src/app/api/**`
   - recebe dados do bridge Python
   - entrega conversas e status para o frontend
   - persiste mensagem, janela e configuração

3. Banco de dados PostgreSQL
   - tabelas: `messages`, `client_windows`, `gse_state`, `app_settings`
   - acesso via Drizzle ORM
   - parte central do estado do sistema

4. Bridge desktop Python
   - script executável que roda junto com WoW
   - escaneia janelas do Windows
   - lê o log de chat do WoW
   - envia mensagens para a API
   - consulta fila e envia respostas de volta para o jogo

Também existe uma camada de addon Lua dentro do WoW:

- `WIMBridge.lua`
- `WIMBridge.toc`
- exporta whispers para o chat log ou para o bridge via formato especial

---

## 3. Stack tecnológica real do projeto

### Frontend
- Next.js 16.2.6
- React 19.2.6
- TypeScript 5.9.3
- Tailwind CSS 4.1.17
- PostCSS

### Backend
- Next.js API Routes
- Node.js runtime
- Drizzle ORM 0.45.2
- PostgreSQL (`pg` 8.20.0)
- dotenv 17.3.1

### Python bridge
- Python 3.x
- `pywin32` / Windows APIs
- `pydirectinput` / `pyautogui`
- `requests`
- leitura de arquivos de log e EnumWindows

### Infra/Deploy
- Neon Postgres
- Vercel
- GitHub Actions para build do Windows EXE

---

## 4. Estrutura de arquivos real do projeto

A estrutura mais relevante é esta:

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css
    download/page.tsx
    gse/page.tsx
    accounts/page.tsx
    settings/page.tsx
    setup/page.tsx
    report/route.ts
    api/
      health/route.ts
      ingest/route.ts
      queue/route.ts
      queue/[id]/ack/route.ts
      status/route.ts
      status/scan/route.ts
      characters/route.ts
      conversations/route.ts
      conversations/[character]/[player]/route.ts
      incoming/recent/route.ts
      gse/route.ts
      gse/[character]/route.ts
      control/route.ts
      admin/settings/route.ts
      admin/init-db/route.ts
      admin/vercel-env/route.ts
      download/[file]/route.ts
  components/
    ChatApp.tsx
    AccountsView.tsx
    GseView.tsx
    SettingsView.tsx
    NavBar.tsx
    useNotifications.ts
  db/
    index.ts
    schema.ts
  lib/
    auth.ts
    ownCharacters.ts
public/
  downloads/
    wim_bridge_gui.py
    wim_bridge.py
    requirements.txt
    config.example.ini
    WIMBridge/
      WIMBridge.lua
      WIMBridge.toc
    WIMBridge.zip
```

A reprodução fiel depende de seguir essa estrutura e, principalmente, manter os nomes e fluxos das rotas e do banco.

---

## 5. Modelo de dados real

Arquivo principal: `src/db/schema.ts`

### Tabela `messages`

```sql
messages (
  id serial primary key,
  character varchar(128) default '',
  player varchar(128) not null,
  direction varchar(16) not null,
  body text not null,
  status varchar(16) not null default 'sent',
  external_id varchar(128),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
)
```

Significado dos campos:

- `character`: qual das janelas do usuário pertence a mensagem
- `player`: a pessoa com quem está conversando
- `direction`: `incoming` ou `outgoing`
- `status`: status de envio das respostas (`pending`, `sent`, `failed`)
- `external_id`: idempotência para evitar duplicações ao re-enviar mensagem da mesma conversa

Índices:

- `messages_player_idx`
- `messages_character_idx`
- `messages_created_at_idx`
- `messages_status_idx`
- `messages_external_id_idx` (unique)

### Tabela `client_windows`

```sql
client_windows (
  id serial primary key,
  character varchar(128) default '',
  window_title varchar(255) not null,
  pid varchar(32) default '',
  hwnd varchar(32) unique,
  foreground varchar(8) default 'no',
  matched varchar(8) default 'no',
  slot varchar(8) default '',
  realm varchar(64) default '',
  last_seen timestamptz default now()
)
```

Essa tabela representa cada janela do WoW detectada no PC do usuário. O bridge envia um scan contínuo para `POST /api/status/scan` com a lista de janelas. O frontend usa `last_seen` para decidir se a janela está online.

### Tabela `gse_state`

```sql
gse_state (
  character varchar(128) primary key,
  running varchar(8) default 'no',
  keybind varchar(32) default '1',
  interval_ms varchar(8) default '100',
  updated_at timestamptz default now()
)
```

Essa tabela guarda o estado de GSE por personagem.

### Tabela `app_settings`

```sql
app_settings (
  key varchar(128) primary key,
  value text not null,
  updated_at timestamptz default now()
)
```

Essa tabela guarda configurações evolutivas, principalmente controles do bridge e token de autenticação.

### Controles padrão do sistema

```ts
DEFAULT_APP_CONTROLS = {
  bridge_reader_enabled: "yes",
  gse_master_enabled: "no",
  whisper_focus_delay_ms: "2000",
  whisper_after_send_delay_ms: "1000",
  whisper_chat_open_delay_ms: "1000",
  whisper_keystroke_delay_ms: "100",
  whisper_chat_send_delay_ms: "1000",
  whisper_close_chat_enabled: "yes",
  whisper_chat_close_delay_ms: "500",
  queue_poll_ms: "1500",
}
```

Esses valores são normalizados no backend em `src/app/api/control/route.ts` e usados pelo bridge para controlar timing da digitação de `/w`.

---

## 6. Autenticação e segurança

Arquivo: `src/lib/auth.ts`

### `checkAdminAuth(request)`

- aceita `x-admin-token` ou `Authorization: Bearer ...`
- usa `ADMIN_TOKEN` ou `BRIDGE_TOKEN` como token esperado
- se tudo vazio, permite acesso em modo dev
- se token errado, retorna `401 unauthorized`

### `checkBridgeAuth(request)`

- aceita `Authorization: Bearer <token>`
- primeiro tenta `process.env.BRIDGE_TOKEN`
- depois tenta `app_settings.bridge_token` no banco
- se nenhum token estiver configurado, o sistema habilita modo sem autenticação

Isso foi desenhado para permitir:

- ambiente local sem configuração
- ambiente de produção com segredo forte
- atualização dinâmica do token pelo painel admin

---

## 7. Fluxo real do sistema de whispers

### 7.1. Fluxo de mensagens recebidas

1. O addon `WIMBridge` do WoW captura o whisper.
2. O addon formata a string com marcador especial, por exemplo:

```text
[WIMBRIDGE]<OWN:MeuChar-Reino><FROM:Comprador-Reino>mensagem do whisper
```

3. O Python bridge observa os logs do WoW, extrai a linha e parseia.
4. O bridge envia `POST /api/ingest` com payload estruturado.
5. O backend executa o parser para detectar:
   - se era `FROM` (incoming)
   - se era `TO` (outgoing, quando você enviou dentro do jogo)
   - nome do personagem
   - nome do jogador
   - corpo da mensagem
6. O backend armazena em `messages` com `direction` e `external_id`.
7. O frontend chama `GET /api/conversations` e `GET /api/incoming/recent` para mostrar listas e disparar notificações.

### 7.2. Fluxo de mensagens enviadas pelo site

1. Usuário escreve mensagem no chat do frontend.
2. O frontend faz `POST /api/conversations/[character]/[player]`.
3. O backend insere a mensagem com status `pending`.
4. O bridge consulta `GET /api/queue` periodicamente.
5. Para cada item pendente, o bridge:
   - identifica a janela correta
   - pausa GSE, se necessário
   - foca a janela do WoW
   - aguarda delay de foco
   - digita `/w <player> <mensagem>`
   - aguarda delay após envio
   - marca mensagem como `sent`
   - envia `POST /api/queue/[id]/ack` com status `sent`

Se a janela não existe ou o foco falha, o bridge pode marcar como `failed` ou simplesmente deixar pendente esperando a janela voltar.

---

## 8. APIs do projeto e comportamento real

Abaixo está o conjunto principal do backend.

### 8.1. `POST /api/ingest`

Autenticação: bridge auth

Objetivo: receber mensagens do bridge Python e persistir no banco.

Entrada esperada:

```json
{
  "messages": [
    {
      "character": "MeuChar-Reino",
      "player": "Comprador-Reino",
      "body": "olá",
      "receivedAt": "2026-08-17T00:00:00Z",
      "direction": "incoming"
    }
  ]
}
```

Comportamento:

- valida payload
- detecta se a string começa com relay WIMBridge
- normaliza `direction`
- gera `external_id` se faltar
- insere via `onConflictDoNothing` para evitar duplicatas
- retorna `inserted` e `received`

### 8.2. `GET /api/queue`

Autenticação: bridge auth

Retorna todas as mensagens de saída pendentes, ordenadas por criação:

```json
{
  "messages": [
    {
      "id": 32,
      "character": "MeuChar-Reino",
      "player": "Comprador-Reino",
      "body": "teste",
      "createdAt": "2026-08-17T00:00:00Z"
    }
  ]
}
```

### 8.3. `POST /api/queue/[id]/ack`

Autenticação: bridge auth

Usado pelo bridge depois de enviar a mensagem para o WoW.

Payload:

```json
{
  "status": "sent",
  "error": ""
}
```

Atualiza:

- `status`
- `sent_at = now()`
- `error` se houver

### 8.4. `GET /api/status`

Público, sem autenticação

Retorna todas as janelas em `client_windows`, calculando online/offline com base em `last_seen`.

Resposta típica:

```json
{
  "windows": [
    {
      "character": "MeuChar",
      "windowTitle": "WoW - MeuChar",
      "online": true,
      "foreground": true,
      "matched": true
    }
  ]
}
```

### 8.5. `POST /api/status/scan`

Autenticação: bridge auth

O bridge envia varredura das janelas do Windows. Payload:

```json
{
  "windows": [
    {
      "character": "MeuChar",
      "windowTitle": "WoW - MeuChar",
      "pid": 1234,
      "hwnd": 456789,
      "foreground": true,
      "matched": true,
      "slot": 1,
      "realm": "Azeroth"
    }
  ]
}
```

Comportamento:

- upsert por `hwnd`
- atualiza `last_seen`
- remove janelas mortas com mais de 30s sem atualização

### 8.6. `GET /api/conversations`

Lista conversas agrupadas por `(character, player)`; retorna:

- `character`
- `player`
- `lastAt`
- `lastBody`
- `lastDirection`
- `incomingCount`
- `totalCount`

A query usa lower-case e normalização para evitar duplicação de conversas se houver letras minúsculas/maiúsculas diferentes.

### 8.7. `GET /api/conversations/[character]/[player]`

Retorna mensagens entre determinado personagem e jogador.

Possui suporte a `?since=id` para incremental sync.

### 8.8. `POST /api/conversations/[character]/[player]`

Cria resposta do usuário no site

- mensagem de saída em `pending`
- `external_id` no formato de resposta
- valida tamanho máximo de 255 caracteres
- detecta realm mismatch, se houver nomes em reinos diferentes

### 8.9. `GET /api/incoming/recent`

Usado pelo frontend para detectar whispers novas mesmo quando a conversa não está aberta.

- `?since=<id>` faz polling incremental
- retorna mensagens recentes de `direction = 'incoming'`
- usado para disparar notificações com `notifyIncoming`

### 8.10. `GET /api/characters`

Lista personagens com contadores:

- total de mensagens
- quantas são incoming
- quantas são outgoing pendentes
- `last_at`

### 8.11. `GET /api/gse` e `POST /api/gse`

Gerência GSE por personagem.

- `GET` lista `gse_state`
- `POST` aceita `action: startAll|stopAll`
- também pode receber `characters` para atuar em subconjunto

### 8.12. `POST /api/gse/[character]`

Atualiza status GSE por um personagem específico:

```json
{
  "running": true,
  "keybind": "1",
  "intervalMs": 100
}
```

### 8.13. `GET /api/control` e `POST /api/control`

Operam sobre `app_settings` para:

- `bridge_reader_enabled`
- `gse_master_enabled`
- delays de foco, envio, chat
- intervalo de polling

O backend normaliza os valores para limites específicos e salva como string.

### 8.14. `GET /api/admin/settings`

Autenticação: admin auth

Retorna:

- estado do banco
- se as tabelas existem
- contadores de tabelas
- máscara de `DATABASE_URL`
- estado do `bridge_token`

### 8.15. `POST /api/admin/settings`

Autenticação: admin auth

Usado para definir `bridge_token` dinâmico no banco.

### 8.16. `POST /api/admin/init-db`

Autenticação: admin auth

Cria as tabelas e índices se não existirem:

- messages
- client_windows
- gse_state
- app_settings

### 8.17. `POST /api/admin/vercel-env`

Autenticação: admin auth

Permite atualizar variáveis de ambiente no Vercel via API.

Parâmetros:

- `vercelToken`
- `projectIdOrName`
- `teamId`
- `databaseUrl`
- `bridgeToken`
- `deployHookUrl`

### 8.18. `GET /api/health`

Público

Faz diagnóstico rápido do ambiente:

- se `DATABASE_URL` existe
- se `BRIDGE_TOKEN` existe
- se banco responde
- contagens das tabelas
- mensagem detalhada em caso de erro

### 8.19. `GET /api/download/[file]`

Público

Serve arquivos relevantes do projeto, como:

- `WIMBridge.zip`
- `wim_bridge.py`
- `requirements.txt`
- `config.example.ini`
- `WIMBridge.lua`
- `WIMBridge.toc`

--

## 9. Frontend principal: fluxo e comportamento real

### `src/components/ChatApp.tsx`

Esse é o coração visual do sistema.

#### Estados principais

- `conversations`
- `characters`
- `statusMap`
- `totalWindowsOnline`
- `characterFilter`
- `selected`
- `messages`
- `draft`
- `sending`
- `newCharacter`
- `newPlayer`
- `bridgeUp`
- `showNotifSettings`
- `unreadMap`

#### Polling

O frontend roda polling em loop para manter UI atualizada:

- `/api/conversations` para lista geral
- `/api/characters` para resumo dos personagens
- `/api/status` para janelas online
- `/api/incoming/recent` para detectar whispers novas
- `/api/conversations/[character]/[player]` para mensagens da conversa aberta

#### Notificações

O hook `useNotifications.ts` implementa:

- som WebAudio
- notificação do navegador
- badge no título da aba quando a janela fica oculta
- prefs salvas em `localStorage` com chave `bakers-whisper:notif-prefs`

A lógica do som usa `AudioContext` e `Oscillator` com duas notas em sequência, criando um chime curto e sem depender de arquivo externo.

#### Layout visual

- cabeçalho com nome “Bakers Whisper” e emoji de pão
- filtro por personagem
- sidebar com lista de conversas
- painel principal para mensagens
- área de envio de mensagem
- badges por status

#### Comportamento da conversa

- conversa selecionada pelo usuário em sidebar
- mensagens são buscadas em ambos os lados (quando houver conversa entre duas contas do usuário e jogador)
- botão de envio dispara `POST /api/conversations/[character]/[player]`
- ao enviar, a mensagem entra com `pending`
- quando o bridge confirma, o status muda para `sent`

#### Realm mismatch

Existe lógica para detectar quando o seu personagem e o outro jogador estão em reinos diferentes; ele dá aviso visual e evita confusão.

---

## 10. Páginas do frontend real

### `/` — chat principal

É a tela principal. Usa `ChatApp`.

### `/accounts`

Exibe status das janelas do WoW em tabela.

Funções:

- mostrar total, online, offline, não mapeadas
- cards de resumo
- lista de janelas com slot, personagem, reino, title, PID, foreground status

### `/gse`

Página de controle de GSE por personagem.

Funções:

- start/stop de todos os personagens
- start/stop individual
- editar keybind e interval
- salvar delays de controle gerais
- tela de gerenciamento de janelas

### `/settings`

Página administrativa.

Funções:

- entrar com token admin
- salvar `bridge_token`
- criar tabelas de banco
- verificar `DATABASE_URL`
- atualizar envs na Vercel
- responder com contadores e status do app

### `/download`

Página de distribuição de binaries e addon

- botão para download do executável mais recente
- alerta de SmartScreen
- instruções de uso
- troubleshooting

### `/setup`

Página de onboarding para montar o sistema do zero.

Explica:

- deploy em Vercel + Neon
- como configurar `DATABASE_URL`
- como configurar `BRIDGE_TOKEN`
- como instalar addon no WoW
- como rodar bridge Python

---

## 11. Bridge Python e ciclo de execução real

Arquivos relevantes:

- `public/downloads/wim_bridge_gui.py`
- `public/downloads/wim_bridge.py`

### Objetivo do bridge

O bridge Python executa em segundo plano e faz três coisas principais:

1. escaneia janelas do WoW
2. lê logs de chat em busca de whispers
3. envia e recebe mensagens com a API

### Lógica de captura de janelas

- usa EnumWindows / Win32 API para enumerar janelas do Windows
- identifica janelas do processo `Wow.exe`
- lê título da janela
- verifica se o título corresponde ao personagem configurado
- mede se a janela está em foreground
- envia snapshot para `/api/status/scan`

### Lógica de leitura de log

- cada janela tem um arquivo de log em `World of Warcraft/_retail_/Logs/WoWChatLog.txt`
- o script faz tail em tempo real para novas linhas
- filtra mensagens relevantes
- detecta sintaxe de tag `WIMBRIDGE` ou `WIMRELAY`
- extrai `OWN`, `FROM` e corpo da mensagem
- envia para `/api/ingest`

### Lógica de envio de resposta

- consulta `/api/queue`
- para cada item pendente:
  - pausa GSE se necessário
  - foca a janela correta
  - espera `whisper_focus_delay_ms`
  - digita `/w <player> <message>`
  - espera `whisper_after_send_delay_ms`
  - libera GSE
  - dispara `POST /api/queue/[id]/ack`

### Delay e timing

Os delays são configuráveis via `app_settings` e controlados pela página `/gse` e `/settings`.

Os principais valores são:

- `whisper_focus_delay_ms`
- `whisper_after_send_delay_ms`
- `queue_poll_ms`
- `whisper_keystroke_delay_ms`

A lógica determina que o bridge não envia mensagens em massa sem paciência de foco e digitação; é uma operação manual controlada, não um spam automágico.

---

## 12. Addon Lua do WoW (`WIMBridge`)

Arquivos:

- `public/downloads/WIMBridge/WIMBridge.lua`
- `public/downloads/WIMBridge/WIMBridge.toc`

### Funcionamento

O addon é responsável por:

- escutar eventos de chat
- capturar whispers recebidos e enviados
- gerar um texto padronizado com origem e destino

Formato típico:

```text
[WIMBRIDGE]<OWN:MeuChar-Reino><FROM:Comprador-Reino>Olá
```

ou

```text
[WIMBRIDGE]<OWN:MeuChar-Reino><TO:Comprador-Reino>Resposta
```

Esse texto é gravado no log de chat e lido pelo bridge Python em `WoWChatLog.txt`.

Sem o addon, o sistema não consegue detectar whispers de maneira confiável, porque o bridge depende do texto estruturado vindo do WoW.

---

## 13. Comportamento de GSE e automação

GSE é outra parte importante do projeto.

### Objetivo

Permitir disparar macro ou sequência de teclas por personagem sem necessariamente focar a janela do WoW.

### Como funciona aqui

- `gse_state` guarda `running`, `keybind` e `interval_ms`
- o bridge faz polling em `GET /api/gse`
- quando `running = yes`, o Python usa `PostMessage` / `WM_KEYDOWN` / `WM_KEYUP` para simular tecla de GSE
- a conexão não exige foco da janela
- a página `/gse` permite controlar cada personagem

### Importante

O backend calcula `gse_master_enabled` e controla se GSE pode estar ativo geral. A página de GSE exibe status por personagem e salva diretamente em `gse_state`.

---

## 14. Como o app se comunica em tempo real

### Padrão de polling

O frontend não usa WebSockets. Ele usa polling periódico.

- chat principal: a cada 1s ou 2s
- status de janelas: a cada 2s
- GSE: a cada 2s
- incoming: também via polling incremental

### Vantagem

- simplifica muito o deploy em Vercel
- funciona com serverless
- não exige infraestrutura de websocket
- é suficiente para uso doméstico

### Limitação

Tempo de atualização depende de polling, então o sistema é “quase em tempo real”, mas não instantâneo.

---

## 15. Lógica de UI e UX real do frontend

### Chat principal

- sidebar com lista de conversas
- cada item mostra o jogador, tempo e preview da última mensagem
- conversas são ordenadas pela última atividade
- `incomingCount` é usado para indicar quantas mensagens novas existiam
- personagem é colorido por `charColor()` em palette determinística

### Mensagens

- mensagens do usuário aparecem com estilo “outgoing” em cores amarelas
- mensagens recebidas aparecem em cor neutra/esverdeada
- o scroll é autoadaptado ao fim da conversa

### Notificações

- som toca em caso de whisper novo
- notificação desktop aparece quando a aba está oculta
- título da aba recebe marcador como `(3) Bakers Whisper - WoW Whisper Chat`

### Status da janela

- online = `last_seen` recente
- foreground = janela ativa
- matched = foi reconhecida como personagem configurado

---

## 16. Padrões de dados para replicação fiel

Para recriar o projeto de forma idêntica, é essencial manter estes padrões:

### Nome e tipo de colunas

- `character` sempre em `varchar(128)`
- `player` sempre em `varchar(128)`
- `direction` como `incoming` / `outgoing`
- `status` como `pending` / `sent` / `failed`
- `hwnd`, `pid`, `slot`, `realm` sempre em strings

### Uso de `lower()` para agrupamento

As queries usam `lower(character)` e `lower(player)` para evitar duplicação por case sensitivity.

### Uso de `external_id`

Para que o bridge não duplique mensagens ao reenviar o mesmo JSON, o `externalId` e `onConflictDoNothing` são fundamentais.

### Padrão de `app_settings`

O sistema depende de valores em `app_settings`, então o clone precisa preservar as chaves e nomes exatos, inclusive a linha `bridge_token`.

### Auth model

Token do bridge e token admin precisam ser compatíveis com o mesmo contrato usado pelos endpoints.

---

## 17. Checklist para replicação fiel da aplicação

Se um novo chat de IA tentar recriar o projeto exatamente, a ordem correta é:

1. Reproduzir as rotas `/api/*` e seus nomes
2. Criar as tabelas com nomes exatos e colunas correspondentes
3. Reproduzir `ChatApp.tsx` e `useNotifications.ts`
4. Reproduzir `AccountsView.tsx`, `GseView.tsx`, `SettingsView.tsx`
5. Reproduzir `layout.tsx` e `NavBar.tsx`
6. Reproduzir lógica de `checkBridgeAuth` e `checkAdminAuth`
7. Implementar bridge Python com polling de filas e leitura de log
8. Implementar addon `WIMBridge`
9. Ajustar `config.ini` e `BRIDGE_TOKEN`
10. Fazer deploy em Vercel + Neon

---

## 18. Como rodar o projeto do zero

### Instalar dependências

```bash
npm install
```

### Rodar localmente

```bash
npm run dev
```

### Build de produção

```bash
npm run build
npm run start
```

### Banco

Em ambiente local ou Vercel, o projeto exige `DATABASE_URL` configurado. Depois do primeiro deploy, normalmente é necessário:

```bash
npx drizzle-kit push
```

### Configuração de ambiente

Variáveis esperadas:

- `DATABASE_URL`
- `BRIDGE_TOKEN`
- opcional: `ADMIN_TOKEN`

---

## 19. Observações de segurança e uso

O projeto é extremamente específico para uso pessoal. O projeto foi montado para automatizar a interação com whispers do WoW e, por isso, envolve software que interpola input em janela do jogo.

- O site pode ser usado para leitura e resposta manual.
- A parte automática depende de foco de janela e digitação em jogo.
- O projeto exige cuidado ao usar em um ambiente online, pois a automação do jogo pode conflitar com regras e termos do jogo.

Apesar disso, no código a implementação foi desenhada como:

- leitura do log
- resposta com foco e digitação manual simulada
- controle explícito por `pending` / `sent` / `failed`

---

## 20. Resumo executivo para uma IA nova

Se um próximo chat de IA quiser recriar este projeto de forma fiel, ele precisa entender isto:

- o app é um painel de whispers do WoW em um único site
- o backend é muito simples e orientado por PostgreSQL
- a principal lógica é o ingest de whispers e a fila de mensagens pendentes
- o frontend é uma UI de chat + monitoramento + GSE + config
- o bridge Python é o componente responsável pela ponte entre o jogo e o site
- o addon Lua gera o formato estruturado que o bridge consegue ler e consumir

Nenhum componente do sistema é “genérico”; tudo foi construído para um fluxo específico de log de whispers, polling e digitação reativa em um jogo com múltiplas janelas.

---

## 21. Prompt de cópia para próximo chat de IA

Se quiser usar este relatório como base para um novo chat, pode mandar algo assim:

> Crie uma cópia fiel do projeto Bakers Whisper. Quero o backend em Next.js API Routes com PostgreSQL, Drizzle ORM, páginas de chat, contas, GSE, settings e download, com autenticação por BRIDGE_TOKEN e ADMIN_TOKEN. O aplicativo deve ter um bridge Python que escaneia janelas do WoW, lê o log e envia mensagens para /api/ingest, consulta /api/queue e digita /w <player> <mensagem> na janela correta. O frontend deve ter uma UI estilo WhatsApp, notificações de whispers, paginação por conversa, polling em tempo real, usando app_settings, client_windows, gse_state e messages. Crie também o addon Lua WIMBridge para formatar mensagens em [WIMBRIDGE]<OWN:...><FROM:...>msg. Preserve os nomes de tabelas, routes e campos reais do projeto.

---

## 22. Conclusão

Este projeto é um ecossistema composto por quatro peças funcionais:

- frontend web para visualização e resposta
- backend API para persistência e orquestração
- banco Postgres para estado real do sistema
- bridge Python + addon Lua para alcançar o WoW e transformar whispers em dados do sistema

A reprodução fiel exige mais do que apenas replicar a aparência; exige manter a arquitetura de dados, a lógica de polling, o formato de mensagens, os nomes das rotas e os contratos de autenticação e sincronização.

Esse relatório foi escrito para servir como origem de verdade para a próxima IA que quiser recriar o projeto de forma idêntica.
