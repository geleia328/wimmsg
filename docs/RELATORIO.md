# 🥐 Bakers Whisper — Relatório Técnico Completo

> Painel web + aplicativo Windows para agregar e responder whispers do World of Warcraft vindos de múltiplas janelas/contas, com suporte a controle de macro GSE.
>
> Versão atual do relatório: `v1.0.7`

---

## 🎯 Objetivo do projeto

Construir um sistema que:

1. **Leia whispers recebidos** em múltiplas janelas do WoW abertas no mesmo PC.
2. **Exiba todos os whispers num painel web** (estilo WhatsApp), com identificação de qual dos seus personagens recebeu cada mensagem.
3. Permita **responder pelo site** e entregue a resposta na janela WoW correta.
4. Ofereça um **controle remoto de macros GSE** (ligar/desligar por personagem + master switch).
5. Exija **configuração mínima** do usuário final (um arquivo `.exe` para baixar; quase zero código).

---

## 🏗 Arquitetura geral

```
┌────────────────────┐        ┌────────────────────┐        ┌────────────────────┐
│  WoW #1 (wow1)    │◀─logs──┤  BakersWhisper.exe │──HTTP──▶  Site (Vercel)     │
│  WoW #2 (wow2)    │        │  (Tkinter, 1 fio   │        │  Next.js + Drizzle │
│  WoW #N (wowN)    │        │   por janela)      │◀─poll──┤  PostgreSQL (Neon) │
└────────────────────┘        └────────────────────┘        └────────────────────┘
```

Três componentes:

| Peça | Tecnologia | Função |
|---|---|---|
| **Addon WoW `WIMBridge`** | Lua | ecoa whispers recebidos com tags `<OWN:...><FROM:...>` no chat log. |
| **Aplicativo desktop** | Python 3.11 + Tkinter, empacotado em um `.exe` via PyInstaller | detecta janelas WoW, lê `WoWChatLog.txt`, envia mensagens ao site, digita respostas no jogo, controla GSE. |
| **Site / API** | Next.js 16 App Router + Drizzle ORM | UI de chat, dashboard de contas, controle GSE, autenticação, armazenamento de mensagens e estado. |
| **Banco de dados** | PostgreSQL (Neon no deploy; Postgres local em dev) | armazena mensagens, janelas, estados GSE, settings e tokens. |

---

## 📦 Estrutura do repositório

```
/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Chat principal
│   │   ├── layout.tsx                  # Layout raiz
│   │   ├── globals.css                 # Tailwind
│   │   ├── accounts/ page.tsx          # Aba "Varrer contas"
│   │   ├── download/ page.tsx          # Página de download do .exe
│   │   ├── gse/ page.tsx               # Aba controle GSE
│   │   ├── settings/ page.tsx          # Aba admin/tokens
│   │   ├── setup/ page.tsx             # Instruções de setup
│   │   └── api/                        # Rotas de API:
│   │       ├── health/route.ts
│   │       ├── ingest/route.ts         # POST mensagens recebidas
│   │       ├── queue/ route.ts         # GET respostas pendentes
│   │       ├── queue/[id]/ack/route.ts
│   │       ├── status/ route.ts        # GET estado das janelas
│   │       ├── status/scan/route.ts    # POST scan das janelas
│   │       ├── characters/ route.ts
│   │       ├── conversations/ route.ts
│   │       ├── conversations/[character]/[player]/route.ts
│   │       ├── incoming/recent/route.ts
│   │       ├── gse/ route.ts
│   │       ├── gse/[character]/route.ts
│   │       ├── control/route.ts        # Master switches/delays
│   │       ├── admin/settings/route.ts
│   │       ├── admin/init-db/route.ts  # Cria tabelas com 1 clique
│   │       └── download/[file]/route.ts
│   ├── components/
│   │   ├── ChatApp.tsx
│   │   ├── AccountsView.tsx
│   │   ├── GseView.tsx
│   │   ├── SettingsView.tsx
│   │   └── useNotifications.ts
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts                   # Todas as tabelas
│   └── lib/
│       └── auth.ts
├── public/
│   └── downloads/
│       ├── wim_bridge_gui.py           # Fonte do app desktop
│       ├── config.example.ini          # (legado do CLI)
│       ├── requirements.txt
│       ├── WIMBridge/                  # Addon .lua/.toc
│       └── WIMBridge.zip
├── .github/workflows/build-windows.yml # Compila o .exe automaticamente
├── docs/
│   └── RELATORIO.md                    # Este arquivo
└── README.md
```

---

## 🗃 Banco de dados (schema PostgreSQL)

### Tabela `messages`
Armazena todos os whispers.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | serial PK | Identificador |
| `character` | varchar(128) | **Seu** personagem que recebeu/enviou (janela). Ex: `taldoglaidon-gallywix` |
| `player` | varchar(128) | O outro lado (buyer / destinatário) |
| `direction` | varchar(16) | `incoming` / `outgoing` |
| `body` | text | Conteúdo da mensagem |
| `status` | varchar(16) | incoming: `received`; outgoing: `pending` / `sent` / `failed` |
| `external_id` | varchar(128) UNIQUE | idempotência (bridge não duplica em retry) |
| `error` | text | Detalhe de falha |
| `created_at` | timestamptz | Quando a mensagem chegou/foi enfileirada |
| `sent_at` | timestamptz | Quando foi enviada com sucesso |

Índices: por `player`, `character`, `created_at`, `status` e unique em `external_id`.

### Tabela `client_windows`
Estado das janelas WoW abertas no PC (enviado a cada 3s pelo `.exe`).

| Coluna | Tipo |
|---|---|
| `id` | serial PK |
| `character` | varchar(128) |
| `window_title` | varchar(255) |
| `pid` | varchar(32) |
| `hwnd` | varchar(32) UNIQUE |
| `foreground` | varchar(8) `yes`/`no` |
| `matched` | varchar(8) `yes`/`no` |
| `slot` | varchar(8) |
| `realm` | varchar(64) |
| `last_seen` | timestamptz |

Considera **online** janelas com `last_seen < now() - 15s`.

### Tabela `gse_state`
Estado desejado do GSE por personagem (fonte da verdade é o site).

| Coluna | Tipo |
|---|---|
| `character` | varchar(128) PK |
| `running` | varchar(8) `yes`/`no` |
| `keybind` | varchar(32) (tecla a ser apertada) |
| `interval_ms` | varchar(8) |
| `updated_at` | timestamptz |

### Tabela `app_settings`
Chave/valor para controles globais e tokens dinâmicos.

| Coluna | Tipo |
|---|---|
| `key` | varchar(128) PK |
| `value` | text |
| `updated_at` | timestamptz |

Chaves usadas:

- `bridge_token` — token dinâmico editado pela UI de admin
- `bridge_reader_enabled`
- `gse_master_enabled`
- `whisper_focus_delay_ms`
- `whisper_after_send_delay_ms`
- `queue_poll_ms`

---

## 🔐 Autenticação

Há dois tokens:

1. **`BRIDGE_TOKEN` (env)** — token estático configurado na Vercel.
2. **`bridge_token` dinâmico (app_settings)** — pode ser alterado pela aba `/settings` sem redeploy.

A API de bridge (`/api/ingest`, `/api/queue`, `/api/status/scan`) aceita **qualquer um** dos dois.

- Se nenhum dos dois estiver configurado (modo dev local), a autenticação é desativada.
- O admin para rotas como `/api/admin/*` usa `ADMIN_TOKEN` ou, na ausência, `BRIDGE_TOKEN`.

Headers esperados:
- `Authorization: Bearer <token>` (bridge)
- `x-admin-token: <token>` (admin UI)

---

## 🌐 API REST

### Mensagens

- `POST /api/ingest` — o `.exe` envia whispers recebidos (idempotente por `externalId`).
- `GET /api/queue` — o `.exe` busca respostas pendentes.
- `POST /api/queue/:id/ack` — o `.exe` confirma envio (sent/failed).
- `GET /api/incoming/recent?since=<id>` — polling de novas mensagens para notificações sonoras.
- `GET /api/conversations`
- `GET /api/characters`
- `GET/POST /api/conversations/[character]/[player]`

### Scan / estado das janelas

- `POST /api/status/scan` — o `.exe` envia lista de janelas abertas a cada ~3s.
- `GET /api/status` — o site consome para a aba `/accounts`.

### GSE

- `GET/POST /api/gse` — listar / bulk start/stop.
- `POST /api/gse/[character]` — atualiza estado/tecla/intervalo de um personagem.

### Controles globais

- `GET/POST /api/control` — master switches e delays.
- `GET /api/admin/settings` — estado completo para a aba `/settings`.
- `POST /api/admin/vercel-env` — atualiza DATABASE_URL/BRIDGE_TOKEN via API da Vercel.
- `POST /api/admin/init-db` — cria tabelas e defaults com 1 clique.

---

## 🧩 Addon `WIMBridge` (Lua)

Objetivo: formatar whispers de forma que o parser do `.exe` consiga identificar:
- **seu personagem** (`OWN`)
- **quem mandou** (`FROM`)
- **corpo da mensagem**

Formato de cada linha no chat:

```
[WIMBRIDGE]<OWN:MeuChar-Reino><FROM:Sender-Reino>texto da mensagem
```

- Escuta: `CHAT_MSG_WHISPER`, `CHAT_MSG_BN_WHISPER`
- Normaliza realm (`Nome` → `Nome-Realm`)
- Usa `DEFAULT_CHAT_FRAME:AddMessage`
- O usuário ativa `/chatlog` no jogo para gravar em `_retail_/Logs/WoWChatLog.txt`.
- Comandos: `/wimbridge test`, `/wimbridge who`.

---

## 🖥️ Aplicativo desktop `BakersWhisper.exe`

### Stack
- **Python 3.11**
- Tkinter (UI)
- `requests` (HTTP)
- `pydirectinput` + `pyautogui` (digitação /w no jogo)
- `pywin32` (`EnumWindows`, `SetForegroundWindow`, `SetWindowText`, `PostMessage`)
- `psutil` (resolve caminho do `Wow.exe` → encontra `Logs/WoWChatLog.txt`)
- **PyInstaller** (empacota em um único `.exe` sem console: `--onefile --noconsole`)

### Threads
| Thread | Função |
|---|---|
| `incoming_worker` (por log único) | faz tail do `WoWChatLog.txt`, extrai whispers, envia ao site via `POST /api/ingest`. |
| `outgoing_worker` | poll `GET /api/queue`, pausa o spammer da janela alvo, foca, digita `/w <player> msg`, confirma via `ack`. |
| `scan_worker` | enumera janelas a cada ~3s, envia para `POST /api/status/scan`. |
| `gse_syncer` | poll `GET /api/gse`; cria/para spammers conforme estado (e master GSE). |
| `control_syncer` | poll `GET /api/control`; aplica master switches, delays, leitor on/off. |

### GSE em background
Cada personagem tem um `GseSpammer` que envia **PostMessage WM_KEYDOWN/WM_KEYUP** direto ao HWND da janela — não precisa focar, não perturba outros clientes.

Parâmetros:
- **tecla** configurável (padrão `1`)
- **intervalo** configurável (padrão 100ms)
- **`pause_event`** — enquanto setado, o spammer para (usado durante envio de whisper e quando master GSE = OFF).

### Detecção e renomeação de janelas

1. Enumera janelas com `EnumWindows`.
2. Mantém apenas as com executável `Wow.exe`/`WowClassic.exe` (fallback: títulos `World of Warcraft` ou `wowN`).
3. Atribui slots `wow1, wow2, ...` por ordem determinística (PID/HWND).
4. Se a janela ainda não se chama `wowN`, renomeia via `SetWindowText`.
5. Cada slot tem um personagem salvo em `%APPDATA%/BakersWhisper/config.json`.

### Config local
`%APPDATA%/BakersWhisper/config.json` contém:
- `server.api_url`
- `server.token`
- `mappings` por `slot:N` → personagem

### Delays de estabilidade (configuráveis pelo site)
- `whisperFocusDelayMs` (padrão 500ms) — entre focar a janela e digitar `/w`.
- `whisperAfterSendDelayMs` (padrão 500ms) — entre apertar Enter e liberar GSE de volta.
- `queuePollMs` (padrão 1500ms) — frequência de checagem de respostas pendentes.

---

## 🌐 Site (Next.js / Vercel)

### Páginas
| Rota | Descrição |
|---|---|
| `/` | Chat principal multi-personagem, notificações sonoras. |
| `/accounts` | Varredura de janelas (online/offline, slot, realm, foreground, PID/HWND). |
| `/gse` | Master switches (leitor/GSE), delays, iniciar/parar por personagem. |
| `/settings` | Admin: status DB, token dinâmico, atualização DATABASE_URL via Vercel API, criar tabelas. |
| `/download` | Página de download amigável para o usuário final. |
| `/setup` | Instruções de instalação (Vercel + Neon + addon + Python). |

### Notificações no navegador
- **Som** (WebAudio, 2 tons A5→E6) a cada novo whisper.
- Notificações desktop (Notification API) quando a aba está oculta.
- Contador no título da aba `(N) Bakers Whisper`.
- Preferências salvas em `localStorage`.

---

## 🚀 Deploy / atualização

### Primeira vez
1. Subir o código no GitHub.
2. Criar banco no Neon e pegar **Pooled connection string**.
3. Criar projeto na Vercel com env vars:
   - `DATABASE_URL` (Neon pooled)
   - `BRIDGE_TOKEN` (token forte)
4. Deploy.
5. Ir em `/settings` com o token admin → clicar em **🧱 Criar/atualizar tabelas agora**.
6. (Opcional) Criar um Deploy Hook na Vercel e colar em `/settings` para redeploy automático após trocar DATABASE_URL.
7. Baixar `BakersWhisper.exe` da release mais recente.

### Build automático do `.exe`
Tag `v*` dispara `.github/workflows/build-windows.yml`:
- instala Python 3.11 no Windows do GitHub Actions
- instala dependências
- injeta `API_URL` e `BRIDGE_TOKEN` no `wim_bridge_gui.py`
- compila com PyInstaller (`--onefile --noconsole`)
- publica como asset da release no GitHub

### Atualização típica
- `git add . && git commit -m "..." && git push` → atualiza site.
- `git tag vX.Y.Z && git push --tags` → gera novo `.exe` automaticamente.

---

## 🔑 Variáveis de ambiente (site)

| Nome | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Pooled connection string Neon/Postgres |
| `BRIDGE_TOKEN` | recomendado | Token estático para o bridge |
| `ADMIN_TOKEN` | não | Token separado para a aba `/settings`; se ausente, usa `BRIDGE_TOKEN` |

---

## 🛟 Troubleshooting

| Problema | Causa | Correção |
|---|---|---|
| `health HTTP 500 / password auth failed` | senha do Neon errada ou URL direta em vez de pooled | Criar `DATABASE_URL` com `-pooler` e `?sslmode=require`; resetar senha do `neondb_owner` se necessário. |
| `relation "messages" does not exist` | tabelas não criadas | `/settings` → botão **Criar/atualizar tabelas agora**; ou rodar `npx drizzle-kit push` local. |
| App abre mas só aparece 1 personagem em todas as janelas | salvamento antigo por `exe_path` | Baixar `v1.0.7+` (salva por slot). |
| Janela "wow1" falsa | detecção antiga por título | `v1.0.6+` prioriza `Wow.exe`; atualizar `.exe`. |
| Mensagem não envia e marca failed | a janela alvo não está aberta/mapeada | agora a mensagem fica `pending`; abra/mapeie a janela e ela envia. |
| GSE continua rodando depois de parar | faltava master switch | `v1.0.6+` tem Master GSE; desliga todos os spammers. |
| SmartScreen bloqueia exe | assinatura de código ausente | "Mais informações → Executar assim mesmo". |
| Whispers não aparecem no site | addon não instalado ou `/chatlog` não foi digitado | instalar `WIMBridge`, `/reload`, `/chatlog`; confirmar que `WoWChatLog.txt` é atualizado. |
| Delay fields voltam ao digitar | polling sobrescrevendo | `v1.0.7+`: drafts locais + botão **💾 Salvar delays**. |

---

## 🔄 Fluxos principais

### Whisper recebido (buyer → você)
1. Jogador manda whisper dentro do WoW.
2. `WIMBridge` imprime linha `[WIMBRIDGE]<OWN:meuChar><FROM:buyer>msg`.
3. `/chatlog` grava no `WoWChatLog.txt`.
4. `incoming_worker` detecta nova linha → `POST /api/ingest`.
5. Site cria/atualiza conversa, dispara notificação sonora/desktop.
6. Você responde pelo site → cria linha em `messages` com `status = pending`.

### Resposta sua (você → buyer)
1. `outgoing_worker` pega a mensagem pendente.
2. Pausa `GseSpammer` daquele personagem.
3. Foca o HWND correto.
4. Espera `whisperFocusDelayMs`.
5. Pressiona Enter → digita `/w buyer msg` → pressiona Enter.
6. Espera `whisperAfterSendDelayMs`.
7. Libera spammer, confirma `ack sent`.

### Controle GSE
1. Site chama `POST /api/gse/[character] {running:true}`.
2. `gse_syncer` detecta novo state.
3. Cria `GseSpammer` para o HWND daquele personagem.
4. Spammer usa `PostMessage` (background) para tecla no intervalo.
5. Se Master GSE = OFF, para **todos** os spammers.

---

## ⚠️ Considerações

- `PostMessage` em background é confiável para chat e teclas de UI em WoW, mas macros de combate podem se comportar diferente em algumas versões.
- O app usa **delays de estabilidade**, não lógicas de evasão.
- O jogador é responsável pelo uso do GSE e do bridge em conformidade com os Termos de Serviço do WoW.

---

## 📌 Versões / changelog resumido

- `v1.0.0`: chat + ingest + queue + addon básico.
- `v1.0.4`: campos API URL/token no exe; diagnóstico health.
- `v1.0.5`: GSE com controle por personagem.
- `v1.0.6`: Master GSE / leitor separados + delays configuráveis.
- `v1.0.7`: correções:
  - detecção rígida de janelas WoW
  - mapeamento por `slot` em vez de `exe_path`
  - botão 💾 Salvar personagens
  - mensagens pendentes não marcam mais como failed quando a janela está fechada
  - drafts de delays sem override do polling
