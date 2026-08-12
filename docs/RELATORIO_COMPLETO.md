# 🥐 BAKERS WHISPER — RELATÓRIO COMPLETO PARA RECRIAÇÃO IDÊNTICA
**Versão do projeto:** v1.0.7  
**Repositório:** https://github.com/geleia328/wimmsg  
**Site em produção:** https://wimmsg-lntm.vercel.app  
**Banco:** Neon Postgres (pooled connection com -pooler + sslmode=require)  
**Data deste relatório:** 2026-08-12 (UTC)

> Este documento é a fonte única da verdade para recriar o projeto exatamente como está no chat atual. Ele foi feito para ser colado em um novo chat como contexto.

---

## 1. OBJETIVO

Painel web para **multi-conta WoW (20+ janelas)** que:
- Detecta whispers recebidos em cada janela via addon + log file.
- Agrega todos os whispers num painel web estilo WhatsApp, mantendo **quem recebeu** (seus personagens `Nome-Reino`) e **quem enviou** (buyers).
- Permite **responder pelo site** e entrega na **janela correta**, identificada por slot `wow1,wow2...` + personagem.
- Controla **GSE (Gnome Sequencer Enhanced)** por personagem e globalmente, tudo pelo site.
- Possui **leitor de whispers** e **GSE** desacoplados (pode ler com GSE off).
- Não perde mensagens: se janela fechada, mensagem fica **pending** (não failed).
- Aplicativo desktop `.exe` **sem necessidade de Python instalado**, com UI tkinter para usuário leigo.

### Casos de uso críticos:
- `taldoglaidon-gallywix` (seu char) recebe whisper de `malaquias-gallywix` (buyer)
- Site mostra conversa `[taldoglaidon-gallywix] ↔ [malaquias-gallywix]`
- Você responde no site → o `.exe` digita `/w malaquias-gallywix <msg>` na janela `wowN` que é `taldoglaidon-gallywix`
- Buyer nunca perde mensagem porque ficou registrado no banco e pushou via ingest.

---

## 2. STACK E DEPENDÊNCIAS

**Frontend:**
- Next.js 16.2.6 App Router (Turbopack)
- React 19.2.6
- Tailwind CSS 4.x
- TypeScript
- Drizzle ORM 0.45.2 + drizzle-kit
- pg driver

**Backend/DB:**
- PostgreSQL (local `app_db`, produção Neon pooled)
- Schema em `src/db/schema.ts`

**Desktop app:**
- Python 3.11
- tkinter (UI)
- requests, pyautogui, pydirectinput, pywin32 (win32gui, win32con, win32api, win32process), psutil, Pillow
- PyInstaller 6.11.1 `--onefile --noconsole --name BakersWhisper`

**WoW:**
- Addon `WIMBridge` Lua
- WoW command `/chatlog` para gravar `WoWChatLog.txt`

---

## 3. ESTRUTURA DE PASTAS ATUAL

```
src/
  app/
    page.tsx (ChatApp)
    layout.tsx
    globals.css
    accounts/page.tsx (AccountsView)
    gse/page.tsx (GseView)
    settings/page.tsx (SettingsView)
    download/page.tsx (Download page público)
    setup/page.tsx (Setup instructions)
    report/route.ts (serve docs/RELATORIO.md)
    api/
      health/route.ts
      ingest/route.ts
      queue/route.ts
      queue/[id]/ack/route.ts
      status/route.ts
      status/scan/route.ts
      characters/route.ts
      conversations/route.ts
      conversations/[character]/[player]/route.ts (GET/POST)
      incoming/recent/route.ts (para notificações)
      gse/route.ts (bulk)
      gse/[character]/route.ts
      control/route.ts (reader/GSE master/delays)
      admin/settings/route.ts (get/set bridge_token dinâmico, counts)
      admin/init-db/route.ts (CREATE TABLE IF NOT EXISTS)
      admin/vercel-env/route.ts (atualiza env da Vercel via API)
      download/[file]/route.ts (serve arquivos com header correto)
  components/
    ChatApp.tsx
    AccountsView.tsx
    GseView.tsx
    SettingsView.tsx
    useNotifications.ts (WebAudio chime)
  db/
    index.ts (drizzle(pool))
    schema.ts (messages, clientWindows, gseState, appSettings, DEFAULT_APP_CONTROLS)
  lib/
    auth.ts (checkAdminAuth sync, checkBridgeAuth async consulta env + app_settings)
public/downloads/
  wim_bridge_gui.py (GUI principal, ver seção detalhada)
  wim_bridge.py (legado CLI, não mais usado mas mantido)
  config.example.ini
  requirements.txt
  WIMBridge/
    WIMBridge.lua
    WIMBridge.toc
  WIMBridge.zip
.github/workflows/build-windows.yml
drizzle.config.json
.env.example, .gitignore, README.md
docs/RELATORIO*.md
```

---

## 4. SCHEMA DO BANCO (src/db/schema.ts completo)

```ts
messages {
  id serial PK
  character varchar(128) NOT NULL DEFAULT '' // seu char
  player varchar(128) NOT NULL // buyer/other
  direction varchar(16) // incoming/outgoing
  body text NOT NULL
  status varchar(16) DEFAULT 'sent' // incoming: received, outgoing: pending/sent/failed
  external_id varchar(128) UNIQUE
  error text
  created_at timestamptz DEFAULT now()
  sent_at timestamptz
}
indexes: player, character, created_at, status, unique(external_id)

clientWindows {
  id serial PK
  character varchar(128) DEFAULT ''
  window_title varchar(255)
  pid varchar(32)
  hwnd varchar(32) UNIQUE
  foreground varchar(8) yes/no
  matched varchar(8) yes/no
  slot varchar(8) // "1" para wow1 etc
  realm varchar(64)
  last_seen timestamptz DEFAULT now()
}
indexes: hwnd unique, character

gseState {
  character varchar(128) PRIMARY KEY
  running varchar(8) DEFAULT 'no'
  keybind varchar(32) DEFAULT '1'
  interval_ms varchar(8) DEFAULT '100'
  updated_at timestamptz DEFAULT now()
}

appSettings {
  key varchar(128) PRIMARY KEY
  value text NOT NULL
  updated_at timestamptz DEFAULT now()
}
// keys: bridge_token, bridge_reader_enabled, gse_master_enabled, whisper_focus_delay_ms, whisper_after_send_delay_ms, queue_poll_ms

DEFAULT_APP_CONTROLS = {
  bridge_reader_enabled: "yes",
  gse_master_enabled: "no",
  whisper_focus_delay_ms: "500",
  whisper_after_send_delay_ms: "500",
  queue_poll_ms: "1500",
}
```

---

## 5. AUTENTICAÇÃO (src/lib/auth.ts)

- **checkAdminAuth(request) sync**: verifica `x-admin-token` ou `Authorization Bearer`. Compara com `ADMIN_TOKEN` env fallback `BRIDGE_TOKEN`. Se nenhum env configurado, permite (dev mode local).
- **checkBridgeAuth(request) async**: verifica Bearer token vs env `BRIDGE_TOKEN` **ou** vs `app_settings.bridge_token` no DB (permite trocar token pelo site sem redeploy). Se nenhum existe, permite. Se existe e não bate, 401.

Rotas protegidas:
- `/api/ingest`, `/api/queue`, `/api/queue/[id]/ack`, `/api/status/scan`, `/api/gse` (quando com Authorization), `/api/control` (quando com Authorization), `/api/admin/*` precisa admin token.

---

## 6. ENDPOINTS DETALHADOS

### 6.1 POST /api/ingest
Body: `{ messages: [{ externalId?, character, player, body, receivedAt? }] }`  
`character` é SEU personagem em `Nome-Reino`. `player` é BUYER.
Faz `INSERT ... ON CONFLICT DO NOTHING (external_id)` para idempotência.
Retorna `{ inserted, received }`.

### 6.2 GET /api/queue
Retorna `{ messages: [{ id, character, player, body, createdAt }] }` onde `direction=outgoing AND status=pending` LIMIT 50 ORDER BY createdAt ASC.

### 6.3 POST /api/queue/[id]/ack
Body `{ status: sent|failed, error? }`. Atualiza `status`, `sentAt=now()`, `error`.

### 6.4 GET /api/status (poll do site)
Retorna todas as janelas detectadas com `online = last_seen < 15s`, `secondsAgo`.

### 6.5 POST /api/status/scan
Body `{ scannedAt?, windows: [{ character?, windowTitle, pid, hwnd, foreground?, matched?, slot?, realm? }] }`  
UPSERT por hwnd. DELETE WHERE last_seen < now() - 30s.

### 6.6 GET /api/conversations
Agrupa por `(character, player)`, retorna última mensagem preview, contadores.

### 6.7 GET /api/characters
Distinct lista de seus personagens com totals.

### 6.8 GET /api/conversations/[character]/[player]
`?since=id` support. Retorna 500 últimas ORDER ASC.

### 6.9 POST /api/conversations/[character]/[player]
Body `{ body }`. Valida 255 chars max. Insere `pending` com `externalId = out-<rand>`. **Detecta realm mismatch** e retorna `warning` se `charRealm != playerRealm`.

### 6.10 GET /api/incoming/recent
`?since=id` global para notificações. ORDER latest then reverses to oldest→newest, retorna `latestId`.

### 6.11 GET/POST /api/gse
GET lista todos. POST bulk `{ action: startAll|stopAll, characters?: string[] }`.

### 6.12 POST /api/gse/[character]
Body `{ running?: boolean, keybind?, intervalMs? }`. Upsert.

### 6.13 GET/POST /api/control
GET retorna `{ controls: { bridgeReaderEnabled, gseMasterEnabled, whisperFocusDelayMs, whisperAfterSendDelayMs, queuePollMs } }`. Pode ser chamado com bearer ou sem.  
POST precisa admin token (`x-admin-token`). Body partial Controls.

### 6.14 GET /api/admin/settings
Precisa admin token. Retorna masked DB URL, env token masks, dynamic token masks, counts, tablesReady boolean, tableErrors.

### 6.15 POST /api/admin/settings
Body `{ bridgeToken }` min 16 chars. Upsert app_settings bridge_token.

### 6.16 POST /api/admin/init-db
Precisa admin token. Executa `CREATE TABLE IF NOT EXISTS` para todas as tabelas + default settings.

### 6.17 POST /api/admin/vercel-env
Para atualizar env na Vercel pelo site. Body `{ vercelToken, projectIdOrName, teamId?, databaseUrl?, bridgeToken?, deployHookUrl? }`. Usa Vercel API `POST /v10/projects/:id/env?upsert=true` com type sensitive target production. Se deployHookUrl fornecido, faz POST nele (redeploy automático).

### 6.18 GET /api/health
Público, sem auth. Tenta `SELECT 1` e counts. Em erro retorna debug detalhado: masked DB URL, error.name, code, cause etc + help array. Isso ajuda diagnosticar senha Neon errada ou falta tabelas.

### 6.19 GET /api/download/[file]
Serve arquivos de `public/downloads` com Content-Disposition attachment, MIME correto para .zip, .py etc. Bypass de bloqueios de navegador.

---

## 7. FRONTEND - PÁGINAS

### / (ChatApp.tsx)
- Header com logo 🥐 Bakers Whisper, indicadores: N janelas online (dot), N personagens, N conversas, pendentes.
- Barra de filtro por personagem (pills com dot verde/cinza de online, contadores).
- Sidebar (96 width) com nova conversa: campos "Seu personagem (ex: Aragorn-Nemesis)" + "Whisper para: Nome-Reino" + botão +.
- Lista conversas agrupadas por (character, player) com badge de character colorido determinístico.
- Painel de mensagens central, scroll auto, diferencia incoming (bg slate-800) vs outgoing (bg amber-600) com timestamps e badge status.
- Input textarea Enter para enviar, Shift+Enter newline, contador 255.
- Botões header: sino notificações (notif settings modal), Download, Contas (verde), GSE (fuchsia), Setup.

**Notificações:** hook useNotifications.ts - AudioContext, chime 2 notas 880Hz+1318.5Hz gain envelope, browser Notification quando hidden, title unread badge (count), localStorage prefs `bakers-whisper:notif-prefs` {sound, desktop, volume}. Poll /api/incoming/recent?since=lastId a cada 2s global, dispara notifyIncoming só para ids maiores que último visto. Primeiro poll é priming, não notifica histórico.

**Realm mismatch:** se character realm != player realm, mostra div vermelha alert no header da conversa.

### /accounts (AccountsView.tsx)
- Cards: Total, Online, Offline, Não mapeadas.
- Tabela: Status dot, Slot (wowN badge amber), Personagem badge emerald, Servidor badge sky, Título, PID, Foreground badge, Visto há Xs.
- Detecta janelas não mapeadas e alerta amarelo explicando como adicionar char.
- Poll /api/status a cada 2s.

### /gse (GseView.tsx)
- Master switches: Leitor (ligado/desligado) e Master GSE (ON/OFF) com botões.
- Delays: 3 inputs number com draft local para evitar override por polling. Draft separado + botão 💾 Salvar delays. Mostra pendente vs salvo.
- Controles globais: Iniciar TODOS / Parar TODOS (bulk).
- Tabela por personagem: Personagem, Slot badge, Status janela dot, Tecla GSE input (edita inline, salva onBlur), Intervalo input, botão iniciar/parar individual (desabilitado se Master OFF e não running).
- Poll /api/status + /api/gse + /api/control a cada 2s.
- updateControls precisa `x-admin-token` do localStorage `bakers-whisper:admin-token`.

### /settings (SettingsView.tsx)
- Acesso admin: input password para token admin (armazena em localStorage). Usa admin token para todos endpoints admin.
- Mostra counts.
- Se tablesReady false, mostra card amarelo com botão criar tabelas.
- PostgreSQL/Neon: mostra masked DB URL atual, seção para atualizar via Vercel API.
  - Inputs: Vercel Access Token, Projeto ID, Team ID opcional, Nova DATABASE_URL, BRIDGE_TOKEN opcional, Deploy Hook URL opcional.
  - Botão Atualizar na Vercel.
- Bridge Token dinâmico: mostra env masked e dynamic masked, input novo, salvar.
- Dá help text sobre onde alterar na Vercel manualmente (Environment Variables).
- Também suporta init-db.

### /download/page.tsx
- Hero com emoji 🥐 grande, título, subtítulo.
- Card verde grande com botão Download que aponta para `https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe`
- Aviso SmartScreen.
- Passo a passo 1-6 (agora 1-7 após adição de servidor) incluindo: abrir WoW, /chatlog, abrir exe, conferir API URL+Token no app, digitar Nome-Reino, Iniciar, abrir site (celular também).
- Seção GSE opcional.
- Troubleshooting 5 problemas comuns.
- Footer links: Abrir painel, Ver versões, Setup avançado.

### /setup/page.tsx
- Seção Vercel+Neon hospedagem grátis detalhada.
- Arquitetura, preparação de janelas, addon, Python bridge, multi-janela, delays, limitações.
- Teste com curl.
- Links agora apontam para `/api/download/` para download correto com headers.

### /report (route.ts)
- Serve docs/RELATORIO.md como text/markdown inline.

---

## 8. PYTHON DESKTOP APP (public/downloads/wim_bridge_gui.py)

### Constantes de build (topo, injetadas pelo CI)
```py
API_URL = "https://wimmsg-lntm.vercel.app"
BRIDGE_TOKEN = "REPLACE_WITH_YOUR_TOKEN" # substituído pelo Actions via secrets
APP_NAME = "Bakers Whisper"
APP_VERSION = "1.0.7" # atualizar a cada release
```

### Config persistência
- Pasta: `%APPDATA%/BakersWhisper` no Windows, `~/.config` no Linux
- Arquivo: `config.json`
Estrutura:
```json
{
  "server": { "api_url": "https://...", "token": "..." },
  "mappings": {
    "slot:1": { "exe_path": "C:\\...", "slot":1, "character":"taldoglaidon-gallywix" },
    "slot:2": { ... }
  }
}
```
- **Importante:** chave é `slot:N`, não exe_path, porque muitas janelas vêm da mesma instalação. Antes havia bug onde todas pegavam mesmo nome.

### Dataclasses
- `SavedMapping(exe_path, slot, character)`
- `ServerSettings(api_url, token)`
- `AppConfig(server, mappings)`
- `DetectedWindow(hwnd, pid, title, exe_path, chat_log, foreground, slot=0)`
- `RuntimeCharacter(character, hwnd, window_title, chat_log)`

### API client
- Session requests com Authorization Bearer se token presente e != placeholder.
- Métodos: `ingest`, `fetch_queue`, `ack`, `scan`, `gse_states`, `controls`, `health()->(ok, msg)` detalhado, `auth_check()->(ok, msg)`.
- `update_server(api_url, token)` atualiza headers em tempo real.

### Detecção de janelas
- Usa `EnumWindows` + `GetWindowText` + `IsWindowVisible`.
- `psutil.Process(pid).exe()` para caminho.
- Aceita janela se `exe_name` in `("wow.exe","wowclassic.exe")` => rigoroso. Fallback se exe não detectável: título exatamente "world of warcraft" ou regex `wowN`.
- Ordena por `(pid, hwnd)` para ordem determinística (estável para assign slots).
- Exclui browser/editors não via exe (antes filtrava genericamente).

### Slot assignment
- Se título já é `wowN`, preserva N.
- Caso contrário atribui menor slot livre.
- Retorna `{hwnd: slot}`.

### Renomear janelas
- `SetWindowText(hwnd, f"wow{slot}")`
- Exposto como botão "Renomear janelas" e checkbox "Renomear ao iniciar" (default True).

### Log path
- `_log_from_exe(exe_path)` = parent / Logs / WoWChatLog.txt
- Verifica existence. Se não existe, aguarda (log avisando "/chatlog").

### Whisper parser
- TIMESTAMP_RE `^\d+/\d+...`
- ADDON_RE `^\[WIMBRIDGE\]<OWN:(?P<own>[^>]+)><FROM:(?P<from>[^>]+)>(?P<body>.*)$`
- Fallout: whispers EN `... whispers: body` e pt-BR `sussurra: body`
- `clean_line`: remove color codes |c, |H...|h etc.
- Retorna tuple (own, sender, body). own default = fallback char.

### Tail file
- Abre em modo texto utf-8 errors replace, seek END, loop readline, sleep 0.4s, detecta rotação por inode ou size shrinking.
- Respeita stop_event.

### GSE Spammer
- Classe `GseSpammer`: `character, hwnd, keybind, interval_ms, pause_event (Event), _stop Event`.
- VK mapping dict: digits 0-9 0x30+i, A-Z ASCII, F1-F12 0x70+i-1, NUMPAD 0x60+i, SPACE, ENTER, TAB, ESC etc.
- `post_key_to_hwnd`: `win32api.MapVirtualKey` -> scan code -> lparam down/up -> `PostMessage WM_KEYDOWN/UP`. Sem foco.
- Loop: se pause setado, sleep 0.05. Senão post key, sleep incremental 0.02 step até interval.
- `stop()` set _stop.
- `update(keybind, interval)`.

### BridgeEngine
- Campos: api, log_cb, status_cb, stop_event, threads list, chars list, spammers dict + lock, controls dict + lock (DEFAULT_CONTROLS).
- `start(chars)`: dedup chat logs, lança tailers, outgoing, scanner, control_syncer, gse_syncer.
- `stop()`: set stop, kill spammers.
- `_incoming(ref)`: para cada linha tail_file, se reader disabled (`controls["bridgeReaderEnabled"]` False) sleep e continue. Senão parse, buffer, ingest a cada 1.5s ou 10 msgs.
- `_outgoing()`: fetch queue, para cada msg, find char by name. Se não encontrar, **NÃO** marca failed, loga "aguardando janela/personagem..." e continue (isso permite pending até janela abrir). Senão pausa spammer da janela, focus, sleep focus_delay, Enter, typewrite `/w player body` com interval 0.02, Enter, sleep after_send_delay, clear pause.
- `DEFAULT CONTROLS` com delays configuráveis pelo site.
- `_control_syncer()`: a cada ~1s busca `api.controls()`, atualiza self.controls, loga mudanças, se gseMaster OFF chama `_stop_all_spammers`.
- `_gse_syncer()`: busca gse_states. Se master OFF, stop all e sleep 1s loop continue. Senão reconcile: para os que não deveriam rodar, atualiza existentes, inicia novos encontrados por nome (precisa RuntimeCharacter match).
- `_scanner()`: enum windows, build payload com hwnd, pid, title, foreground, character (matched), matched bool, slot, realm (extraído via realm_of). Envia scan, update status count.
- `_find_char_by_name`, `_find_char_by_hwnd`.
- `_stop_all_spammers(reason)`: set pause+stop all, clear dict, log.
- `_get_controls()` thread-safe copy.

### GUI (App class)
- Tkinter dark: BG #0f172a, FG #e2e8f0, ACCENT amber-500, CARD #1e293b, OK #10b981, BAD #ef4444.
- Header com logo, versão, status label "sem conexão" -> "servidor online" / "server online, token inválido".
- Info card com steps 1-4.
- Server settings card com API URL Entry e Token Entry (show bullets), botões Salvar servidor (💾) e Testar conexão (🌐 Testar). Grid layout.
- Table: header Slot, Título, Personagem-Reino, Log, (foreground). Row: slot label bold, truncated title, Entry com prefill de slot mapping, log status ok/ /chatlog, foreground badge.
- Controls: ▶ Iniciar, ⏹ Parar, 🔄 Rescan, 🔤 Renomear janelas, 💾 Salvar personagens, 🌐 Testar conexão, checkbox Renomear ao iniciar, botão Abrir Painel (webbrowser.open API_URL).
- Log window ScrolledText dark consolas 9pt.
- Log queue flushed a cada 200ms via after.
- Auto scan a cada 5s quando bridge not running (detecta novas janelas, assign slots, render).
- Health check a cada 10s: chama health + auth_check, update status label com green/orange/red + log only on state change.
- on_first_scan: enum + assign slots.
- on_rename_now: apply_renames.
- on_save_characters: saves entries por slot:key.
- on_save_server: valida api_url starts http, update api client, save_config, log, test connection.
- on_test_connection: spawns thread log test health+auth.
- on_start: optional rename if auto checkbox, collect chars from non-empty entries, warn if no realm suffix, call _save_character_entries, create BridgeEngine, start.
- on_stop: engine.stop.
- _update_status_counters: shows mapped/total + GSE count.
- main(): Tk root, App, protocol WM_DELETE_WINDOW stop+destroy, mainloop.

### Constantes importantes
- WOW_TITLE_HINTS ("world of warcraft","wow") - old, now stricter.
- WOW_EXE_HINTS ("wow.exe","wowclassic.exe")
- WM_KEYDOWN 0x100, WM_KEYUP 0x101
- _VK_MAP inclui F1-F12, NUMPAD, SPACE etc.

### Bugs corrigidos v1.0.5→v1.0.7
- v1.0.5: slot per exe_path bug (same exe path windows overwrote). Fixed per slot.
- v1.0.6: GSE continuing after stop, no master GSE, delays hardcoded. Fixed with control sync.
- v1.0.7: delay inputs overwritten by polling, tkinter bad screen distance tuple bug, per-slot character save missing, window false positives (amazon.com containing wow?), queue failed when window closed.

---

## 9. ADDON WIMBRIDGE

**WIMBridge.toc:**
```
## Interface: 110000
## Title: WIM Bridge
## Notes: Mirrors received whispers into the chat log with a [WIMBRIDGE] tag including own character name, for multi-window setups.
## Author: WIM Bridge
## Version: 2.0.0
## SavedVariables: WIMBridgeDB

WIMBridge.lua
```

**WIMBridge.lua:**
- Cria Frame, registra CHAT_MSG_WHISPER, CHAT_MSG_BN_WHISPER, PLAYER_LOGIN
- ownName computed via UnitName("player") + realm normalization via GetNormalizedRealmName/GetRealmName.
- normalize(name): if no "-", append -realm.
- On whisper: line = `[WIMBRIDGE]<OWN:own><FROM:from>msg` → DEFAULT_CHAT_FRAME:AddMessage(line, 0.6,0.6,1.0)
- Slash /wimbridge test/who.
- zip containing folder WIMBridge/ with these 2 files.

---

## 10. GITHUB ACTIONS (.github/workflows/build-windows.yml)

Triggers: tags `v*` and manual dispatch.
Jobs: windows-latest, permissions contents write.
Steps:
- checkout v4
- setup-python 3.11 x64
- show python info
- pip install pyinstaller==6.11.1, requests, pydirectinput, pyautogui, pywin32, psutil, Pillow, pywin32-ctypes + sanity checks import win32gui etc.
- Inject build constants: PowerShell reads file UTF8, replaces API_URL regex and BRIDGE_TOKEN placeholder with secrets API_URL, BRIDGE_TOKEN. Write UTF8 without BOM.
- Sanity-check ast.parse file.
- Build: pyinstaller --onefile --noconsole --name BakersWhisper --collect-submodules pyautogui pydirectinput psutil --hidden-import win32gui win32con win32api win32process pywintypes pkg_resources.py2_warn public/downloads/wim_bridge_gui.py
- Verify dist/BakersWhisper.exe exists.
- Upload artifact BakersWhisper-Windows retention 30d.
- Create Release via softprops/action-gh-release@v2 with files dist/BakersWhisper.exe, name, body instructions.

**Secrets necessários no repo:** `API_URL` = https://wimmsg-lntm.vercel.app, `BRIDGE_TOKEN` = novo token (ex 32 hex). GitHub UI Settings→Secrets→Actions.

---

## 11. SITE DEPLOY (Vercel)

- Framework preset Next.js
- Env vars: `DATABASE_URL` (pooled Neon) + `BRIDGE_TOKEN` (opcional mas recomendado). `ADMIN_TOKEN` opcional for settings separado.
- Build command default.
- Deploy hook opcional para auto-redeploy após env update via site.
- Health endpoint `/api/health` sem auth mostra counts and status.

---

## 12. NEON / POSTGRES

- Pooled connection obrigatório para serverless: host contém `-pooler`, param `?sslmode=require` plus sometimes `&channel_binding=require` from Neon UI.
- Reset password via Roles → neondb_owner → Reset.
- Connection Details → Pooled.

---

## 13. TROUBLESHOOTING HISTÓRICO

| Erro | Causa | Fix |
|---|---|---|
| `bad screen distance "82"` | Tkinter Label padx/pady tuple | usar int simples para Label padding |
| `from __future__ imports must occur...` | const antes do future import | mover future import logo após docstring |
| `git pull --rebase` unstaged | changes não commitados | git add . + commit |
| `failed to push some refs` | remote avançado | git pull origin main --rebase |
| Build falha pywin32 missing | Pip não instalou | pip install pywin32 pywin32-ctypes Pillow |
| Health 500 `password auth failed` | DATABASE_URL senha errada | reset password Neon, upsert na Vercel, redeploy |
| Health 500 `relation messages does not exist` | tabelas não criadas | /settings → criar tabelas ou npx drizzle-kit push |
| App mostra sem conexão mas health no browser ok | token mismatch | trocar token no app + salvar servidor, testar |
| Delay volta ao digitar | polling sobrescreve | draft local + botão salvar |
| Rescan apaga nomes diferentes | save by exe_path | save by slot:N |
| wow1 falso | detecção por substring "wow" | detecção estrita por Wow.exe + regex wowN |
| GSE não para | sem master switch | add control gseMasterEnabled |
| Mensagem failed se janela fechada | ack failed quando char não configurado | deixar pending, log aguardando |

---

## 14. PENDENTES / PRÓXIMOS PASSOS

- **Responsividade mobile** (solicitado por último): ChatApp sidebar como drawer em <768px, header hamburger, accounts table scroll horizontal, gse grid single col, settings cards stacking, paddings. Ainda não implementado no momento deste relatório.
- Melhorias potenciais: PWA, busca histórico, templates respostas rápidas, notificações sonoras toggle por personagem, onboarding wizard.

---

## 15. COMO RECRIAR IDÊNTICO A PARTIR DESTE RELATÓRIO

**Para a próxima IA:**
1. Crie projeto Next.js App Router com Tailwind, Drizzle ORM, pg.
2. Copie schema exato da seção 4 para `src/db/schema.ts`.
3. Crie `src/lib/auth.ts` com lógica async bridge + sync admin descrita na seção 5.
4. Implemente TODAS as rotas API listadas na seção 6 com os comportamentos idênticos (atenção: ingest idempotente, queue 50 limit, scan upsert + GC 30s, online 15s, control defaults, etc).
5. Crie componentes conforme seção 7 (detalhes de UI, polling 2s, realm warnings, notifications hook).
6. Copie lógica completa do Python GUI da seção 8 (incluir todas as classes, threads, detecção estrita, slot logic, mapping por slot, server settings card, botões, delays configuráveis via /api/control).
7. Recrie addon Lua idêntico seção 9.
8. Recrie workflow YAML seção 10.
9. Configure `.gitignore` para ignorar node_modules, .env, .next.
10. Crie páginas /download, /setup, /report, /settings, /accounts, /gse, / como descrito.
11. Adicione route `/api/download/[file]` com Content-Disposition.
12. Valide com `next typegen`, `tsc --noEmit`, `npm run build`, `build_and_start`.

**Prompt sugerido para próximo chat:**
```
Você é um dev fullstack. Vou colar um relatório completo (RELATORIO_COMPLETO.md) de um projeto chamado Bakers Whisper. Seu trabalho é recriar o projeto IDÊNTICO, arquivo por arquivo, com todas as APIs, schema, GUI Python, addon Lua, GitHub Actions, páginas, autenticação, delays, GSE, slots wow1..wowN, etc.
Não simplifique. Mantenha nomes, tabelas, endpoints exatamente iguais.
Depois gere o projeto e valide com typegen, tsc, build e build_and_start.
Aqui está o relatório:
<cole conteúdo de docs/RELATORIO_COMPLETO.md>
```

---

## 16. COMANDOS ÚTEIS

```bash
npm install
npm run dev # localhost:3000
npx drizzle-kit push # cria tabelas, precisa DATABASE_URL env
git add .
git commit -m "..."
git push
git tag v1.0.x
git push --tags
# Vercel Redeploy: Dashboard -> Deployments -> ... -> Redeploy
# Test health: https://wimmsg-lntm.vercel.app/api/health
# Test download exe: https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe
```

---

## 17. SEGURANÇA E AVISOS

- DATABASE_URL contém usuário/senha — nunca deve ser exposta em print público. O novo health mascara.
- BRIDGE_TOKEN embutido no .exe pode ser extraído via strings. Aceitável para uso privado mas não para público geral.
- GSE e automação violam ToS Blizzard. Uso é por conta do usuário. O sistema não implementa anti-detecção; delays são apenas estabilidade técnica.
- .env nunca vai pro Git.

---

## 18. CREDITOS E CONTEXTO FINAL

Projeto iniciado para responder whispers via WIM addon como se fosse chat. Evoluiu para multi-janela, renomeação automática wowN, reconhecimento de realm, varredura de contas, notificações sonoras, controle GSE em background via PostMessage, reader toggle separado, delay configurável, settings admin com troca de DATABASE_URL via Vercel API e inicialização de tabelas com 1 clique.

Última versão funcional no momento deste relatório: `v1.0.7`, com PyInstaller build verde em Actions (tag v1.0.7) e site online em wimmsg-lntm.vercel.app.
```

Site: https://wimmsg-lntm.vercel.app
Repositório: https://github.com/geleia328/wimmsg
Download direto: https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe

**Fim do relatório.**

---

