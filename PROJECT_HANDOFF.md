# 📋 RELATÓRIO COMPLETO DE HANDOFF — PROJETO BAKERS WHISPER

> **Data:** 2026-08-12  
> **Versão do .exe:** 1.0.7  
> **Último deploy:** Funcionando em https://wimmsg-lntm.vercel.app  
> **Último commit:** `fix python future import position`  
> **Último workflow v1.0.1:** Verde ✅

---

## 🎯 O QUE É O PROJETO

**Bakers Whisper** é um sistema para:
1. **Receber** whispers (mensagens privadas) do World of Warcraft
2. **Exibir** essas mensagens num site/web
3. **Responder** pelo site
4. **Enviar** a resposta de volta ao jogo
5. **Controlar** múltiplas janelas do WoW (wow1, wow2, wow3...)
6. **Controlar** macros GSE (rotação automática)
7. **Notificar** com sons/text-to-speech

**IMPORTANTE:** O programa NÃO é um bot. O usuário **decide quando responder**, mas o addon+bridge automatiza o caminho entre:
- Aba de whisper do WIM (dentro do jogo)
- Painel web (no navegador)
- Resposta volta via keystroke (simulando o que o usuário faria manualmente)

---

## 🏗️ ARQUITETURA

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   WoW + Addon    │  HTTPS  │  Site Vercel     │  HTTPS  │  Navegador       │
│  (WIMBridge.lua) │ ──────► │  (Next.js API)   │ ◄────── │  (chat, /gse,    │
│  + BakersWhisper │         │  PostgreSQL      │         │   /settings)     │
│  .exe (Python)   │ ◄────── │  (Neon)          │ ──────► │                  │
└──────────────────┘         └──────────────────┘         └──────────────────┘
       │                                                               │
       │  1. whisper chega no WIM                                      │
       │  2. addon [WIMBRIDGE]<OWN:X><FROM:Y>msg                      │
       │  3. /chatlog grava no WoWChatLog.txt                          │
       │  4. .exe lê o arquivo e manda pra API                         │
       │  5. site mostra no chat                                       │
       │  6. usuário digita resposta no site                           │
       │  7. addon pega do site e cola no WIM                          │
       │  8. ...ou USUÁRIO digita manualmente e clica "enviar"         │
       │                                                               │
```

**Fluxo de ENVIO (o mais importante):**
1. Usuário vê whisper no site
2. Usuário digita resposta no site
3. Site armazena como `pending` no banco
4. BakersWhisper.exe monitora a fila do site
5. Ao encontrar reply pendente → abre a janela do WIM correspondente → cola texto → aperta Enter
6. Resultado: whisper sai do jogo como se o usuário tivesse digitado

---

## 📁 ESTRUTURA DO PROJETO

### Arquivos-chave no repositório

```
bakers-whisper/
├── .github/workflows/build-windows.yml     # CI/CD que compila .exe via PyInstaller
├── public/
│   ├── wim-bridge/
│   │   ├── WIMBridge.toc                    # Manifesto do addon WoW
│   │   ├── WIMBridge.lua                    # Addon principal (escuta whispers)
│   │   ├── WIMBridge_Pasteback.lua          # Abre WIM e cola texto
│   │   ├── WIMBridge_Scanner.lua            # Escaneia janelas abertas
│   │   └── Defaults.lua                     # Config padrão do addon
│   ├── installer/
│   │   ├── install-windows.bat              # Instalador Windows (one-click)
│   │   └── install-mac-linux.sh             # Instalador Mac/Linux
│   └── downloads/
│       ├── wim_bridge_gui.py                # ⭐ CÓDIGO-FONTE DO .EXE (1658 linhas)
│       ├── whisper_announcer.py             # ✨ NOVO: Announcer TTS (550 linhas)
│       └── requirements.txt                 # Dependências Python
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/route.ts              # Healthcheck público (sem auth)
│   │   │   ├── ingest/route.ts              # Recebe whisper do .exe (auth)
│   │   │   ├── queue/route.ts               # Fila de replies pendentes (auth)
│   │   │   ├── queue/[id]/ack/route.ts      # Confirma envio (auth)
│   │   │   ├── status/route.ts              # Status das janelas (auth)
│   │   │   ├── status/scan/route.ts         # Scan de janelas do .exe
│   │   │   ├── control/route.ts             # Controles globais (reader, GSE, delays)
│   │   │   ├── gse/route.ts                 # Estado GSE (auth)
│   │   │   ├── gse/[character]/route.ts     # GSE por personagem
│   │   │   ├── conversations/route.ts       # Lista conversas (auth)
│   │   │   ├── conversations/[char]/[player]/route.ts  # Mensagens (auth)
│   │   │   ├── characters/route.ts          # Personagens com stats (auth)
│   │   │   ├── incoming/recent/route.ts     # Whisper recentes para notificações
│   │   │   ├── download/[file]/route.ts     # Download de arquivos
│   │   │   ├── admin/settings/route.ts      # Config admin (auth)
│   │   │   ├── admin/init-db/route.ts       # Cria tabelas one-click
│   │   │   └── admin/vercel-env/route.ts    # Atualiza DATABASE_URL via API Vercel
│   │   ├── page.tsx                         # Chat principal
│   │   ├── download/page.tsx                # Página de download do .exe
│   │   ├── setup/page.tsx                   # Tutorial de setup
│   │   ├── gse/page.tsx                     # Controle GSE
│   │   └── settings/page.tsx                # Config admin
│   ├── components/
│   │   ├── ChatApp.tsx                      # ⭐ UI principal do chat (737 linhas)
│   │   ├── GseView.tsx                      # UI do controle GSE (562 linhas)
│   │   ├── SettingsView.tsx                 # UI das configurações (393 linhas)
│   │   └── useNotifications.ts              # Hook de notificações sonoras
│   ├── db/
│   │   ├── index.ts                         # Conexão PostgreSQL via Drizzle
│   │   └── schema.ts                        # Schema do banco (148 linhas)
│   ├── app/
│   │   ├── globals.css                      # Estilos base
│   │   └── layout.tsx                       # Layout raiz
│   └── lib/
│       └── auth.ts                          # Autenticação (admin + bridge)
├── vercel.json                              # Config de deploy na Vercel
├── package.json                             # Dependências Node
├── .env                                     # DATABASE_URL local
├── drizzle.config.json                      # Config Drizzle ORM
├── README.md                                # Documentação
└── PROJECT_HANDOFF.md                       # Este arquivo
```

---

## 🗄️ BANCO DE DADOS (Neon PostgreSQL)

### Variável de ambiente DATABASE_URL

```
postgresql://neondb_owner:<SENHA>@ep-fancy-rice-axt6thqi-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Tabelas

#### messages
```sql
messages (
  id SERIAL PRIMARY KEY,
  character VARCHAR(128) NOT NULL DEFAULT '',    -- meu personagem
  player VARCHAR(128) NOT NULL,                  -- quem mandou
  direction VARCHAR(16) NOT NULL,                -- incoming | outgoing
  body TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'sent',    -- sent | pending | failed | received
  external_id VARCHAR(128),                      -- hash pra deduplicação
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
)
```

#### client_windows
```sql
client_windows (
  id SERIAL PRIMARY KEY,
  character VARCHAR(128) DEFAULT '',
  window_title VARCHAR(255) NOT NULL,
  pid VARCHAR(32) DEFAULT '',
  hwnd VARCHAR(32) DEFAULT '',
  foreground VARCHAR(8) DEFAULT 'no',
  matched VARCHAR(8) DEFAULT 'no',
  slot VARCHAR(8) DEFAULT '',       -- wow1, wow2, etc.
  realm VARCHAR(64) DEFAULT '',
  last_seen TIMESTAMPTZ DEFAULT now()
)
```

#### gse_state
```sql
gse_state (
  character VARCHAR(128) PRIMARY KEY,
  running VARCHAR(8) DEFAULT 'no',
  keybind VARCHAR(32) DEFAULT '1',
  interval_ms VARCHAR(8) DEFAULT '100',
  updated_at TIMESTAMPTZ DEFAULT now()
)
```

#### app_settings
```sql
app_settings (
  key VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
)
-- Chaves conhecidas:
-- bridge_token: token dinâmico para autenticação do bridge
-- bridge_reader_enabled: yes/no (leitor ligado/desligado)
-- gse_master_enabled: yes/no (master switch global)
-- whisper_focus_delay_ms: 500 (default)
-- whisper_after_send_delay_ms: 500 (default)
-- queue_poll_ms: 1500 (default)
```

### Indexes

```sql
messages_player_idx ON messages (player)
messages_character_idx ON messages (character)
messages_created_at_idx ON messages (created_at)
messages_status_idx ON messages (status)
messages_external_id_idx ON messages (external_id) UNIQUE
client_windows_hwnd_idx ON client_windows (hwnd) UNIQUE
client_windows_character_idx ON client_windows (character)
```

---

## 🔐 AUTENTICAÇÃO

O site usa token Bearer. Qualquer endpoint marcado como `(auth)` requer:

```
Authorization: Bearer <token>
```

### Onde o token é configurado

**Na Vercel (Environment Variable):**
- `BRIDGE_TOKEN` — usado pelo .exe e pelo site

**No banco (app_settings):**
- `bridge_token` — token dinâmico editável pelo `/settings`

### Prioridade de verificação
1. Token na Environment Variable `BRIDGE_TOKEN`
2. Token dinâmico em `app_settings.bridge_token`
3. Se nenhum existe → modo dev (aceita qualquer coisa)

### Rotas que exigem auth (bridge)
- `/api/ingest` — POST para enviar whisper ao site
- `/api/queue` — GET para pegar respostas pendentes
- `/api/queue/[id]/ack` — POST para confirmar envio
- `/api/status` — GET para ver janelas ativas
- `/api/status/scan` — POST para atualizar scan
- `/api/control` — GET/POST para controles globais

### Rotas que exigem auth (admin)
- Todas as rotas `/api/admin/*`
- `/api/conversations` e derivadas
- `/api/characters`
- `/api/gse` e derivadas
- `/api/incoming/recent`

### Rota pública
- `/api/health` — healthcheck (não requer token)

---

## 🖥️ O APP DESKTOP (wim_bridge_gui.py)

### Versão atual: v1.0.7

### O que ele faz
1. Detecta todas as janelas do WoW abertas no PC (via psutil)
2. Renomeia as janelas para wow1, wow2, wow3... (via pywin32)
3. Lê cada `WoWChatLog.txt` em tempo real
4. Parseia linhas com o padrão `[WIMBRIDGE]<OWN:X><FROM:Y>msg`
5. Manda essas mensagens pro site via API
6. Busca respostas pendentes no site
7. Ao achar resposta → abre janela do WIM → cola texto → aperta Enter
8. Gerencia GSE (ligar/desligar macros)

### Fluxo do envio (PasteBack)
```
1. msg = poll_queue()  // busca resposta pendente
2. hwnd = find_window(msg.character)  // acha janela pelo título "wow1", "wow2"...
3. focus_hwnd(hwnd)  // traz janela pro frente
4. time.sleep(0.3)  // espera foco estabilizar
5. type_string("/w " + msg.player + " " + msg.body)  // digita via PostMessage
6. press_key(VK_RETURN)  // aperta Enter
7. ack(msg.id, "sent")  // confirma envio no site
```

### Config salva em
```
%APPDATA%/BakersWhisper/config.json
```

### Estrutura do config.json
```json
{
  "server": {
    "api_url": "https://wimmsg-lntm.vercel.app",
    "authToken": "8eefce8c...",
    "pollInterval": 2.0
  },
  "mappings": {
    "slot:1": {
      "exe_path": "C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Wow.exe",
      "slot": 1,
      "character": "taldoglaidon-gallywix"
    },
    "slot:2": {
      "exe_path": "C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Wow.exe",
      "slot": 2,
      "character": "outrochar-gallywix"
    }
  }
}
```

### Dependências Python
```
requests
psutil
pywin32
```

### Para compilar .exe
```
pyinstaller --onefile --noconsole --name "BakersWhisper" wim_bridge_gui.py
```

---

## 🌐 SITE (Next.js)

### Hospedado em: https://wimmsg-lntm.vercel.app

### Páginas
| Rota | Descrição |
|------|-----------|
| `/` | Chat principal — conversas, sidebar, composer |
| `/download` | Download do .exe (aponta pro GitHub Releases) |
| `/setup` | Tutorial completo de setup |
| `/gse` | Controle GSE + delays + master switches |
| `/settings` | Admin: banco, tokens, Vercel API |

### Componentes React
| Arquivo | Linhas | Função |
|---------|--------|--------|
| `ChatApp.tsx` | 737 | Chat principal, sidebar, composer |
| `GseView.tsx` | 562 | Controle GSE, delays, master switch |
| `SettingsView.tsx` | 393 | Config admin, tokens, Vercel API |
| `useNotifications.ts` | ~80 | Sons de notificação |

---

## 🔗 APIs (resumo)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/health` | ❌ | Healthcheck público |
| POST | `/api/ingest` | ✅ | Recebe whisper do .exe |
| GET | `/api/queue` | ✅ | Busca respostas pendentes |
| POST | `/api/queue/[id]/ack` | ✅ | Confirma envio |
| GET | `/api/status` | ✅ | Janelas ativas |
| POST | `/api/status/scan` | ✅ | Scan de janelas |
| GET | `/api/control` | ✅ | Controles globais |
| POST | `/api/control` | ✅ | Atualiza controles |
| GET | `/api/gse` | ✅ | Estado GSE |
| POST | `/api/gse` | ✅ | Bulk start/stop |
| POST | `/api/gse/[char]` | ✅ | GSE por personagem |
| GET | `/api/conversations` | ✅ | Lista conversas |
| GET | `/api/conversations/[char]/[player]` | ✅ | Mensagens |
| POST | `/api/conversations/[char]/[player]` | ✅ | Envia reply |
| GET | `/api/characters` | ✅ | Personagens |
| GET | `/api/incoming/recent` | ✅ | Recebe notificações |
| GET | `/api/download/[file]` | ❌ | Download estático |
| GET | `/api/admin/settings` | ✅ | Status config |
| POST | `/api/admin/settings` | ✅ | Atualiza token |
| POST | `/api/admin/init-db` | ✅ | Cria tabelas |
| POST | `/api/admin/vercel-env` | ✅ | Atualiza env na Vercel |

---

## ⚙️ COMANDOS IN-GAME (do addon)

| Comando | Descrição |
|---------|-----------|
| `/bw status` | Mostra URL, token, slot, personagem, fila |
| `/bw slot` | Mostra qual slot (wow1, wow2...) esta janela é |
| `/bw url` | Mostra URL configurada |
| `/bw set <url>` | Troca URL do site |
| `/bw token <token>` | Troca token de auth |
| `/chatlog` | Ativa log do chat (OBRIGATÓRIO) |

---

## 🔊 SISTEMA DE NOTIFICAÇÕES

### No site (`/`)
- 🔔 Sound toggle no header
- Painel de config de volume e som
- Sons gerados por Web Audio API (arquivos externos não necessários)
- Sons: inbound-new, inbound-active, outbound-sent, outbound-failed

### Announcer TTS (`whisper_announcer.py`)
- Script Python separado (550 linhas)
- Usa pyttsx3 para TTS offline
- Monitora WoWChatLog.txt em tempo real
- Anuncia em voz alta: "Whisper from [nome]: [mensagem]"
- Configurável: velocidade, volume, voz, toggle
- **Não envia nada** — apenas lê e anuncia

---

## 🐛 BUGS CORRIGIDOS (histórico)

### 1. PyInstaller: `from __future__` no início
**Causa:** `from __future__ import annotations` estava depois de constantes  
**Fix:** movido para antes das constantes no `wim_bridge_gui.py`

### 2. GitHub Actions falhou no build
**Causa:** arquivo `wim_bridge_gui.py` com erro de sintaxe Python  
**Fix:** corrigido `from __future__` + workflow v1.0.1 verde

### 3. App mostrava "sem conexão com servidor"
**Causas:** 3 situações possíveis:
- (a) Token inválido → configure token no app
- (b) DATABASE_URL incorreta na Vercel → resetar senha Neon
- (c) Tabelas não existem → usar /settings → Criar tabelas

### 4. Tkinter crash `bad screen distance "82"`
**Causa:** `pady=(8, 2)` em Label não suportado  
**Fix:** trocado por `pady=4` (número único)

### 5. DATABASE_URL incorreta (password auth failed)
**Causa:** senha antiga do Neon na Vercel  
**Fix:** resetar senha no Neon → atualizar DATABASE_URL na Vercel → redeploy

### 6. Relation "messages" does not exist
**Causa:** tabelas não criadas no Neon  
**Fix:** /settings → botão "Criar/atualizar tabelas agora" (via /api/admin/init-db)

### 7. Delay no GSE reescrevia valor digitado
**Causa:** polling React a cada 2s sobrescrevia o input  
**Fix:** estado `delayDirty` + botão "Salvar delays" explícito

### 8. GSE continuava rodando após parar
**Causa:** master switch global faltando  
**Fix:** `gseMasterEnabled` global via `/api/control` + `_control_syncer` no Python

### 9. Todos personagens iguais após Rescan
**Causa:** mapeamento por exe_path (mesma pasta = mesmo exe)  
**Fix:** mapeamento por slot (wow1, wow2...) em vez de exe_path

### 10. Mensagens falhavam se janela não estava aberta
**Causa:** marcava `failed` imediatamente  
**Fix:** mantém como `pending` e loga "aguardando janela"

---

## 🚀 COMO ATUALIZAR

### Atualizar o site
```bash
git add .
git commit -m "msg"
git push
```
→ Vercel faz deploy automático

### Atualizar o .exe
```bash
git add .
git commit -m "msg"
git push
git tag v1.0.8
git push --tags
```
→ GitHub Actions compila novo .exe → Release criada → site aponta pra nova release

---

## 🔑 CREDENCIAIS E URLs

### URLs
| Serviço | URL |
|---------|-----|
| Site | https://wimmsg-lntm.vercel.app |
| GitHub | https://github.com/geleia328/wimmsg |
| Vercel Dashboard | https://vercel.com/dashboard |
| Neon Console | https://console.neon.tech |

### Token de auth
```
8eefce8c0cee1ff235d9c8ef1cdae83c
```
⚠️ Usado no app desktop e como BRIDGE_TOKEN. Configurado em:
- GitHub Secrets (para compilar o .exe)
- Vercel Environment Variables
- %APPDATA%/BakersWhisper/config.json

### DATABASE_URL (Neon)
```
postgresql://neondb_owner:<SENHA>@ep-fancy-rice-axt6thqi-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require
```
⚠️ Senha foi resetada durante o desenvolvimento. Verificar no Neon.

---

## 📋 TODO REMANESCENTE

### Bugs conhecidos
1. **Rescan às vezes sobrescreve mapeamentos** — pode ser race condition no scanner
2. **GSE não para 100% em todos cenários** — verificar se pause_event está sendo respeitado em todas as threads
3. **self.chars no BridgeEngine não atualiza dinamicamente** — se janela abre depois do bridge rodando, precisa reiniciar
4. **Mensagens pending ficam para sempre** — se personagem nunca abrir, deveria ter timeout

### Melhorias sugeridas
1. **Dinamizar self.chars** — adicionar personagens novos sem reiniciar bridge
2. **Bottom navigation mobile** — barra fixa no rodapé
3. **Sidebar recolhível** — toggle no mobile
4. **Timeout de mensagens** — marcar como failed após X minutos
5. **Dashboard com métricas** — taxa de sucesso, total de whispers
6. **Export/import de config** — backup do config.json
7. **Teste guiado de setup** — wizard interativo

---

## 🎯 PARA O PRÓXIMO CHAT: PROMPT SUGERIDO

Cole isso no início do próximo chat:

```
Você é um desenvolvedor full-stack. O projeto é o Bakers Whisper, um sistema para
receber e responder whispers do World of Warcraft remotamente pelo navegador.

Arquitetura:
- Site Next.js na Vercel (https://wimmsg-lntm.vercel.app)
- Banco PostgreSQL no Neon
- Programa desktop Python (BakersWhisper.exe) compilado via PyInstaller
- Addon Lua para o WoW
- GitHub Actions para build do .exe

Fluxo:
1. Buyer manda whisper → addon gera log → .exe lê log → POST /api/ingest
2. Usuário vê whisper no site → digita reply → POST /api/conversations/[char]/[player]
3. Reply fica pendente no banco
4. .exe busca fila → foca janela WIM → cola texto → aperta Enter → ack

Código-fonte do .exe: public/downloads/wim_bridge_gui.py (1658 linhas)
Schema: src/db/schema.ts
APIs: src/app/api/ingest/route.ts, queue/route.ts, control/route.ts
Chat: src/components/ChatApp.tsx
GSE: src/components/GseView.tsx

Problemas conhecidos:
- Rescan sobrescreve mapeamentos às vezes
- GSE pode não parar 100%
- self.chars não atualiza dinamicamente
- Mensagens pending ficam para sempre se janela não abrir

Versão atual: v1.0.7
Último deploy: funcionando em produção
```

---

*Relatório gerado em 2026-08-12 por Bakers Whisper Development Team*
