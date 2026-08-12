# 🥐 BAKERS WHISPER - RELATÓRIO MINUCIOSO COMPLETO PARA PRÓXIMO CHAT
**Data:** 2026-08-12
**Versão final deste chat:** v1.0.7
**Repo:** https://github.com/geleia328/wimmsg
**Site:** https://wimmsg-lntm.vercel.app
**Banco:** Neon Postgres Pooled (-pooler + sslmode=require)
**Branch principal:** main
**Tags de release:** v1.0.0 .. v1.0.7 (workflow .github/workflows/build-windows.yml gera BakersWhisper.exe)

> Se você colar este arquivo inteiro num novo chat e pedir para a IA recriar o projeto idêntico, ela terá tudo.

---

## 0. COMO USAR ESTE ARQUIVO

1. Faça push deste arquivo pro GitHub:
```bash
git add docs/BAKERS_WHISPER_COMPLETE_HANDOFF.md
git commit -m "add complete handoff report"
git push
```
2. No novo chat, envie este arquivo + o seguinte prompt (ver seção 14).
3. Peça também responsividade mobile (pendente).

---

## 1. VISÃO GERAL

Aplicativo + site para 20+ janelas WoW simultâneas:
- Cada janela é renomeada para `wow1,wow2...` via SetWindowText.
- Addon Lua WIMBridge ecoa whispers como `[WIMBRIDGE]<OWN:meuChar-Reino><FROM:buyer-Reino>mensagem`.
- Ativando `/chatlog` no WoW, cada linha vai para `_retail_/Logs/WoWChatLog.txt`.
- App Python .exe detecta janelas (EnumWindows por Wow.exe), faz tail do log, parse com regex, POST /api/ingest.
- Site exibe conversas agrupadas por (character=seu char, player=buyer) estilo WhatsApp.
- Você responde no site -> INSERT messages status=pending.
- App faz GET /api/queue e, para cada pendente:
  - pausa GseSpammer daquela janela (pause_event.set)
  - foca HWND
  - espera whisperFocusDelayMs (500ms default, configurável pelo site /api/control)
  - digita `/w <player> <msg>` via pydirectinput/pyautogui
  - espera whisperAfterSendDelayMs (500ms)
  - libera spammer e ack sent.
- Se janela fechada, não marca failed: deixa pending com log "aguardando janela...".
- GSE: spammer por personagem em background via PostMessage WM_KEYDOWN/WM_KEYUP, sem foco. Controlado por /api/gse (per-char) e /api/control master switches.
- Reader e GSE são desacoplados: pode ler whispers com GSE OFF.
- Notificações sonoras WebAudio, desktop notifications, title badge contagem, localStorage prefs.
- Varredura de contas: /accounts tabela online/offline, slot, realm, title, PID, foreground.
- Admin: /settings permite trocar bridge_token dinâmico, criar tabelas (init-db), atualizar env da Vercel via API (DATABASE_URL / BRIDGE_TOKEN) + redeploy hook.
- Download page /download: botão pega latest release do GitHub, instrucciones leigas, troubleshooting, aviso SmartScreen.
- Relatórios: /report serve docs/RELATORIO_COMPLETO.md ou docs/RELATORIO.md.

---

## 2. ESTRUTURA REAL DE ARQUIVOS (extraído via list_files)

```
src/
  app/
    page.tsx
    layout.tsx
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
    useNotifications.ts
  db/
    index.ts
    schema.ts
  lib/
    auth.ts
public/downloads/
  wim_bridge_gui.py (1526 linhas na v1.0.7)
  wim_bridge.py (legado CLI)
  requirements.txt
  config.example.ini (legado)
  WIMBridge/
    WIMBridge.lua
    WIMBridge.toc
  WIMBridge.zip
.github/workflows/build-windows.yml
docs/
  RELATORIO.md (versão antiga)
  RELATORIO_COMPLETO.md (completo anterior)
  BAKERS_WHISPER_COMPLETE_HANDOFF.md (este arquivo)
  HANDOFF_PROMPT.md
drizzle.config.json, package.json, next.config.ts, tsconfig.json, .gitignore, .env.example, README.md
```

---

## 3. SCHEMA COMPLETO (src/db/schema.ts) - COPIA EXATA v1.0.7

Mesmo conteúdo já entregue no chat, mas repetindo minucioso:

messages: id serial PK, character varchar128 DEFAULT '', player varchar128, direction varchar16, body text, status varchar16 default sent, external_id varchar128 unique, error text, created_at timestamptz default now(), sent_at timestamptz, indexes player, character, created_at, status, unique external_id.

clientWindows: id serial PK, character varchar128 default '', window_title varchar255, pid varchar32 default '', hwnd varchar32 unique, foreground varchar8 default no, matched varchar8 default no, slot varchar8 default '', realm varchar64 default '', last_seen timestamptz default now(). index character.

gseState: character varchar128 PK, running varchar8 default no, keybind varchar32 default 1, interval_ms varchar8 default 100, updated_at timestamptz default now().

appSettings: key varchar128 PK, value text, updated_at timestamptz default now(). Keys usadas: bridge_token, bridge_reader_enabled, gse_master_enabled, whisper_focus_delay_ms, whisper_after_send_delay_ms, queue_poll_ms. Defaults: yes,no,500,500,1500.

---

## 4. AUTENTICAÇÃO (src/lib/auth.ts) - LÓGICA EXATA

checkAdminAuth(request) SYNC:
- expected = ADMIN_TOKEN || BRIDGE_TOKEN env.
- provided = header x-admin-token || Bearer token.
- Se expected vazio => allow. Senão compara, 401 se diferente.

checkBridgeAuth(request) ASYNC:
- provided = Bearer.
- envToken = BRIDGE_TOKEN trimmed.
- Se envToken e provided==envToken => allow.
- Tenta ler app_settings.bridge_token do DB (try/catch se DB down).
- Se dbToken e provided==dbToken => allow.
- Se nenhum token existe (env vazio e db vazio) => allow dev mode.
- Senão 401.

---

## 5. TODAS AS APIS - COMPORTAMENTO MINUCIOSO

**POST /api/ingest** precisa auth bridge async. Body {messages: [{externalId?, character, player, body, receivedAt?}]}. Filtra vazios, externalId gerado random se não fornecido, createdAt Date. INSERT ... ON CONFLICT DO NOTHING target externalId. Retorna inserted.

**GET /api/queue** precisa auth bridge. SELECT id,character,player,body,createdAt WHERE outgoing pending ORDER createdAt LIMIT 50.

**POST /api/queue/[id]/ack** precisa auth bridge. Body {status: sent|failed, error?}. Update status, sentAt now(), error.

**GET /api/status** público (sem auth bridge, usado pelo site polling). SELECT * FROM clientWindows ORDER lastSeen DESC, computa online = now - lastSeen < 15000ms.

**POST /api/status/scan** precisa auth bridge. Body {windows: [{character?, windowTitle, pid, hwnd, foreground?, matched?, slot?, realm?}]}. Para cada: upsert por hwnd. SET character,windowTitle,pid,foreground,matched,slot,realm,lastSeen now(). Depois DELETE WHERE last_seen < now()-30s (GC).

**GET /api/conversations** - SELECT character,player,MAX(created_at) last_at, subselects body e direction da última mensagem, counts. GROUP BY character,player ORDER last_at DESC LIMIT 500.

**GET /api/characters** - SELECT character, COUNT total, FILTER incoming, FILTER pending out, MAX created_at. GROUP BY character.

**GET /api/conversations/[character]/[player]** query ?since=id. SELECT * WHERE player=player AND character=character AND (id>since) LIMIT 500 ORDER createdAt ASC.

**POST /api/conversations/[character]/[player]** Body {body}. 255 chars max. Insere pending outgoing externalId out-<rand>. Detecta realm mismatch: charRealm = após último "-", playerRealm idem, se ambos existem e diferentes, gera warning string, retorna {message, warning}.

**GET /api/incoming/recent** ?since=id. WHERE incoming + id>since, ORDER DESC limit 50, retorna reverso (oldest->newest) + latestId max.

**GET /api/gse** lista gseState todos.

**POST /api/gse** bulk. Body {action: startAll|stopAll, characters?}. Se characters presente, upsert cada um. Senão UPDATE todos set running=target. Precisa auth só se header Authorization presente (site chama sem auth, bridge chama com auth, checagem condicional if authHeader).

**POST /api/gse/[character]** Body {running?, keybind?, intervalMs?}. Upsert por character.

**GET/POST /api/control** GET se tiver Authorization header checa bridge auth, senão público para site (site polling). Retorna controls normalizados com defaults. POST precisa admin token. Body partial Controls (boolean + numbers). Upsert cada key em app_settings.

**GET /api/admin/settings** precisa admin auth. Lê bridge_token row, counts messages/windows/gseState (safeCount try/catch, retorna ok false se falta tabela). Retorna masked DB URL (func mask first 4 last 4), envConfigured booleans, dynamicConfigured, tableErrors, tablesReady = appSettings && messages && windows && gse ok.

**POST /api/admin/settings** precisa admin auth. Body {bridgeToken} min 16 chars. Upsert.

**POST /api/admin/init-db** precisa admin auth. Executa CREATE TABLE IF NOT EXISTS para messages, clientWindows, gseState, appSettings. Cria indexes IF NOT EXISTS. Insere defaults controls se não existem (ON CONFLICT DO NOTHING).

**POST /api/admin/vercel-env** precisa admin auth. Body {vercelToken, projectIdOrName, teamId?, databaseUrl?, bridgeToken?, deployHookUrl?}. Valida databaseUrl começa postgresql:// contém @ / e sslmode=require. Para cada env presente, faz fetch POST https://api.vercel.com/v10/projects/:id/env?upsert=true&teamId=... com body [{key,value,type:sensitive,target:[production],comment}]. Authorization Bearer vercelToken. Retorna updated array. Se deployHookUrl presente, POST nele. Precisa redeploy manual se não houver hook.

**GET /api/health** público. Coleta env hasDatabaseUrl, masked, hasBridgeToken. Tenta db.execute select 1, depois counts. Se ok retorna ok true counts. Em erro retorna ok false, error debug detalhado (name, message, code, detail, hint, cause name/message/code/errno/syscall/hostname), masked DB URL, help array com instruções DATABASE_URL pooled, sslmode, redeploy, drizzle-kit push.

**GET /api/download/[file]** público. ALLOWED set {WIMBridge.zip, wim_bridge.py, requirements.txt, config.example.ini, WIMBridge.lua, WIMBridge.toc}. Procura em public/downloads/<file> e public/downloads/WIMBridge/<file>. Serve com content-type mapeado (zip application/zip, py text/x-python, etc) e disposition attachment filename.

---

## 6. FRONTEND PÁGINAS / COMPONENTES - COMPORTAMENTO MINUCIOSO

**ChatApp.tsx:**
- State: conversations, characters, statusMap (map character->WindowStatus), totalWindowsOnline, characterFilter ALL, selected {character,player}, messages, draft, sending, newCharacter, newPlayer, bridgeUp, showNotifSettings, lastIncomingIdRef (-1 priming).
- refreshTop: fetch /api/conversations + /api/characters + /api/status em paralelo, set states, build statusMap, onlineCount.
- fetchMessages: /api/conversations/:char/:player.
- Poll refreshTop cada POLL_MS 2000ms.
- Poll fetchMessages quando selected existe cada 2s.
- Poll incoming/recent: se lastIncomingIdRef <0 priming captura latestId sem notificar. Senão para cada mensagem com id>last, chama notif.notifyIncoming.
- useNotifications hook: prefs localStorage bakers-whisper:notif-prefs {sound,desktop,volume}. AudioContext resume on click/keydown. playChime via Oscillator sine 880Hz 0.12s + 1318.5Hz 0.09s offset, gain envelope attack 0.01 linear ramp to 0.6, exponential to 0.0001. testChime button. notifyIncoming: if sound && ctx play, if desktop && permission granted && visibility != visible => new Notification(`Whisper de ${player}`, body `[${character}] ${body}`, tag). Title badge unread count quando hidden.
- UI: header com logo 🥐 (gradient amber), titulo Bakers Whisper, subtítulo com dot online + N personagens + N conversas + pendentes. Sino 🔔/🔕, Download (amber), Contas (emerald), GSE (fuchsia), Setup (slate).
- Filter bar: pill Todos + per personagem com dot verde/cinza online, pending count amber.
- Sidebar w-96 border-r: nova conversa card com inputs seu personagem (list datalist known) + whisper para + botão +. Lista filteredConversations. Cada item button com truncate player, timeAgo, badge character color deterministico via charColor hash palette, lastBody preview → outgoing.
- Main: se !selected placeholder 💬. Se selected header com Whisper com player bold amber, via character badge + online/offline text. Se realmMismatch (char realm != player realm) mostra div rose alert. Messages scrollRef auto bottom. Mine outgoing amber-600 slate-950, theirs slate-800. Status badge pending/sent/failed. Input textarea max 255, Enter sem Shift envia, placeholder `Responder ${player} pela janela ${char}...`, botão Enviar amber. Footer hint "Python bridge focará janela X e digitará /w player ...".
- Realm mismatch computed via useMemo char split "-" last.

**AccountsView.tsx:**
- State windows, bridgeUp, loading. Poll /api/status 2s.
- Derived online, offline, unmapped.
- Header com logo 📡 Varredura.
- Cards stats: Total, Online emerald, Offline rose, Não mapeadas amber/slate.
- Table thead Status, Slot, Personagem, Servidor, Título, PID, Foreground, Visto. Body: dot online, slot badge wow{slot} amber, character badge emerald, realm badge sky, title mono, pid mono, foreground amber badge em foco, secondsAgo.
- Alerta unmapped: explica adicionar block character.
- Links back to chat.

**GseView.tsx:**
- State windows, states map, controls, delayDraft {string versions}, delayDirty bool, busy map, bridgeUp.
- refresh fetch status+gse+control.
- characters = union windows character + states keys sorted.
- runningCount filter running.
- updateOne fetch POST /api/gse/:char.
- bulk startAll/stopAll POST /api/gse.
- updateControls: lê admin token localStorage bakers-whisper:admin-token, POST /api/control com x-admin-token.
- saveDelays: converte delayDraft strings to numbers, valida finite, chama updateControls.
- UI: header ⚙ Controle GSE, running badge.
- Global controls: grid 2 cols cards Leitor e Master GSE com toggle buttons emerald/fuchsia.
- Delay inputs: 3 inputs number min/max step, value delayDraft, onFocus setDirty true, onChange setDraft, display pending vs saved spans, button 💾 Salvar delays disabled !dirty.
- Bulk buttons Iniciar TODOS / Parar TODOS disabled logic.
- Table per-char: Personagem mono emerald, Slot badge amber, Status dot, Tecla GSE input (local states setState on change, onBlur updateOne), Intervalo input number, GSE button iniciar/parar (disabled busy or master OFF && not running).
- Help box como configurar GSE.

**SettingsView.tsx:**
- State adminToken from localStorage bakers-whisper:admin-token mount, bridgeToken new input, settings payload, error, saving, vercel fields state (vercelToken, vercelProject default wimmsg-lntm, teamId, databaseUrl, envBridgeToken, deployHookUrl).
- headers = x-admin-token + content-type.
- load: set localStorage admin token, GET /api/admin/settings.
- saveBridgeToken POST.
- initDb POST /api/admin/init-db.
- updateVercelEnv POST /api/admin/vercel-env.
- UI sections: Acesso admin input password + Entrar button, error div rose if any. Se settings: Status counts Stat cards, tablesReady warning amber with button criar tabelas + pre tableErrors json, PostgreSQL/Neon section com atual DB masked + card alterar via Vercel API com inputs vercel token, project, teamId, new DB URL textarea, bridge token input, deploy hook input, button Atualizar variáveis. Bridge Token section com envConfigured masks, dynamic masks, input novo token, salvar button. Help box.
- Stat component.

**Download page /download:**
- Hero 20x20 gradient, 4xl title, subtitle. Card emerald grande download EXE com DIRECT_EXE_URL `https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe`. Warning SmartScreen amber card. Steps how to use 6 steps (abrir WoW, /chatlog, abrir exe, conferir servidor section, digitar Nome-Reino, Iniciar, abrir site). GSE optional section fuchsia, troubleshooting 5 problems, footer buttons.

**Setup page /setup:**
- Hospedagem grátis Vercel+Neon seção verde com steps. Arquitetura, janelas, addon, Python bridge, etc. Download links via /api/download/ (force headers). Instalar addon section com zip + alternativa avulsos toc/lua com instruções "Salvar link como". Teste curl snippets.

**useNotifications.ts:**
- Prefs defaults sound true, desktop false, volume 0.5, storage key bakers-whisper:notif-prefs, load/save localStorage, playChime WebAudio, testChime, notifyIncoming com sound + desktop Notification + title badge unread.

**layout.tsx:** metadata title Bakers Whisper — WoW Whisper Chat, description multi-janela, lang pt-BR, body bg-slate-950.

---

## 7. PYTHON DESKTOP APP (public/downloads/wim_bridge_gui.py) - MINUCIOSO v1.0.7

Já detalhado antes, mas aqui ainda mais minucioso:

**Top:** from __future__ import annotations must be second line after docstring (pyinstaller syntax error fixed). Constants API_URL https://wimmsg-lntm.vercel.app, BRIDGE_TOKEN placeholder, APP_NAME, APP_VERSION 1.0.7.

**App data dir:** %APPDATA%/BakersWhisper (Windows) or ~/.config/BakersWhisper. Config file config.json.

**ServerSettings:** api_url, token.

**AppConfig:** server + mappings dict slot->SavedMapping.

**SavedMapping:** exe_path, slot, character. Migration: old exe_path keyed configs converted to slot:N if slot present.

**ApiClient:** requests Session, api_url stripped, token stripped, _apply_headers clears then adds Authorization Bearer if token != placeholder, content-type json, user-agent App/Version. Methods ingest, fetch_queue, ack, scan, gse_states, controls, health()->(bool,str), auth_check()->(bool,str). health GET /api/health timeout 8s, auth_check GET /api/queue timeout 8s detect 401.

**Window detection:**
- WOW_EXE_HINTS ("wow.exe","wowclassic.exe")
- WOW_TITLE_HINTS old but now stricter: title exactly "world of warcraft" or regex wow\d+.
- _pid_for_hwnd via win32process.GetWindowThreadProcessId
- _exe_for_pid via psutil.Process(pid).exe()
- _log_from_exe: Path(exe).parent / Logs / WoWChatLog.txt
- enum_wow_windows: if not HAS_WIN32 return []. Get fg hwnd. For each EnumWindows visible: get title stripped, if empty continue. get pid, exe canonical name lower. looks_wow_by_exe = exe_name in hints. looks_wow_by_title = low=="world of warcraft" or fullmatch wow\d+. Keep if looks_wow_by_exe OR (not exe and title match). Then append DetectedWindow. Sort by (pid,hwnd) deterministic.
- focus_hwnd: if iconic ShowWindow SW_RESTORE, SetForegroundWindow.
- rename_hwnd: SetWindowText.
- assign_slots: preserve existing wowN title keeps slot, otherwise smallest free. Returns hwnd->slot.
- apply_renames: iterate wins, target f"wow{slot}", if current != target rename_hwnd.

**Keypress background:**
- _VK_MAP: digits 0-9 0x30+i, A-Z ordinal, F1-F12 0x70+i-1, NUMPAD0-9 0x60+i, SPACE 0x20, ENTER 0x0D, TAB 0x09, ESC 0x1B, SHIFT 0x10, CTRL 0x11, ALT 0x12, - 0xBD, = 0xBB, [ 0xDB, ] 0xDD, ` 0xC0.
- key_to_vk uppercase lookup.
- WM_KEYDOWN 0x100, WM_KEYUP 0x101.
- post_key_to_hwnd: MapVirtualKey vk 0 => scan, lparam_down (scan<<16)|1, lparam_up (scan<<16)|(1|(1<<30)|(1<<31)), PostMessage.

**GseSpammer:** character,hwnd,keybind,interval_ms clamped 50-2000, log_cb, pause_event (SET=paused), _stop Event, _thread. start(), stop() set _stop, update(), _run loop: if pause set sleep 0.05 continue, vk=key_to_vk(keybind), if vk post_key_to_hwnd, sleep incremental 0.02 until interval.

**Engine:**
- spammers dict char->GseSpammer + lock
- controls dict DEFAULT_CONTROLS + lock
- start(chars): clear stop, dedup logs, launch tailers per unique log path, outgoing, scanner, control_syncer, gse_syncer, log.
- stop: set stop, stop all spammers, clear.
- _get_controls thread-safe copy.
- _control_syncer: loop fetch api.controls(), merge over defaults, set self.controls, log reader on/off master on/off changes, if master OFF _stop_all_spammers.
- _stop_all_spammers: set pause+stop each, clear dict.
- _gse_syncer: fetch gse_states, if master OFF -> stop all sleep 1s continue, else reconcile existing (stop if not desired running, else update keybind/interval), start new if desired running and char exists in runtime chars (find by name).
- _find_char_by_name/hwnd.
- tail_file: waits file existence log each 10s, opens, seeks END, tracks inode, size, readline loop, handle rotation.
- parse_whisper: raw stripped TIMESTAMP_RE, ADDON_RE match, else clean: remove |c color, |H...|h, |h, |r, brackets, then fallback regex whispers/sussurra. Return (own,sender,body).
- _incoming: buffer list, flush every 1.5s or 10 msgs ingest. Respects bridgeReaderEnabled flag: if disabled sleep 0.2 continue.
- _outgoing: fetch queue, for each msg check stop, find RuntimeCharacter by name, if not found log "aguardando janela..." continue (leave pending). Else pause spammer if exists, lock _send_lock, get delays from controls, focus_hwnd, sleep focus_delay, press Enter via pydirectinput/pyautogui, sleep 0.08, typewrite /w player body interval 0.02, sleep 0.05, press Enter, sleep after_delay, clear pause. Ack sent or failed.
- _scanner: enum windows, build payload list dict hwnd,pid,windowTitle,foreground,character (matched), matched bool, slot, realm (realm_of char). Call api.scan, status callback mapped/total + GSE count.

**GUI App:**
- Tk root 900x680 BG #0f172a.
- Header: logo 🥐 Bakers Whisper vVersion, status label red "sem conexão" -> green/orange.
- Info card steps 1-4.
- Server settings card: label Servidor amber bold, API URL Entry 48 width dark, Token Entry show •, buttons 💾 Salvar servidor, 🌐 Testar.
- Wrap table container scroll Canvas.
- Table header: Slot, Título, Personagem-Reino, Log, (foreground).
- Row: slot text wowN bold amber, title truncated 22+…, Entry dark consolas 9pt prefill from mappings slot:N, log ok/fail, foreground "🎯 em foco".
- Controls: ▶ Iniciar green, ⏹ Parar red, 🔄 Rescan, 🔤 Renomear, 💾 Salvar personagens green, 🌐 Testar conexão, checkbox Renomear ao iniciar, Abrir Painel button.
- Log window ScrolledText bg #020617 fg FG consolas 9pt.
- Log queue flushed every 200ms after.
- Auto scan every 5s when engine None: enum new, assign slots via assign_slots, set slot on each, detect changes in count or hwnd set, render.
- Health check every 10s: health + auth_check.
- on_first_scan: enum + assign slots, set slot, render, log.
- on_rename_now: apply_renames.
- _save_character_entries: iterates rows, gets name, w.slot, key slot:N, if name saves mapping, else removes if exists, set config.mappings = self.mappings, save_config, returns count.
- on_save_characters: call helper log.
- on_save_server: valida api_url startswith http, update config server, api.update_server, save_config, log, call on_test_connection.
- on_test_connection: thread check health+auth log.
- on_start: if auto_rename var true rename, then collect chars from non-empty entries, build RuntimeCharacter list with hwnd, title, chat_log Path, persist via _save_character_entries, warn if no realm suffix (askyesno), create BridgeEngine, start, disable start enable stop.
- on_stop: engine.stop, enable start disable stop.
- _update_status_counters: with spammers lock count GSE, update status label with mapped/total + GSE.
- main: Tk, try iconbitmap default, App, protocol delete window stop+destroy, mainloop.

**Bugfixes timeline:**
- v1.0.0-1.0.3: basic bridge
- v1.0.4: server settings editable UI, health diagnostics, exception bad screen distance "82" due to pady tuple in Label (fixed to int), future import position.
- v1.0.5: GSE control per char + bulk.
- v1.0.6: master GSE + reader toggle + delays configurable via /api/control, pending not failed when char missing, stop_all_spammers, control_syncer, delay drafts bug.
- v1.0.7: slot mapping by slot:N not exe_path, stricter window detection Wow.exe only, wowN regex, deterministic order PID/HWND, save personagens button, pending stays pending, delay drafts local state.

---

## 8. ADDON LUA (WIMBridge)

- WIMBridge.toc version 2.0.0, interface 110000, title WIM Bridge, notes, author, SavedVariables.
- WIMBridge.lua: Frame registers CHAT_MSG_WHISPER, BN_WHISPER, PLAYER_LOGIN. ownName variable. normalize(name) adds realm if no "-". computeOwnName via UnitName("player"). OnEvent: if PLAYER_LOGIN computeOwnName return, if ownName Unknown computeOwnName, from normalize(sender), line = "[WIMBRIDGE]<OWN:own><FROM:from>msg", DEFAULT_CHAT_FRAME:AddMessage(line, 0.6,0.6,1.0). Slash /wimbridge test/who.

---

## 9. GITHUB ACTIONS WORKFLOW

File .github/workflows/build-windows.yml detailed:
- name Build Windows Executable
- on push tags v* + workflow_dispatch manual
- jobs build runs-on windows-latest permissions contents write
- steps: checkout v4, setup-python 3.11 x64, show python info, pip install pyinstaller 6.11.1, requests, pydirectinput, pyautogui, pywin32, psutil, Pillow, pywin32-ctypes, sanity import win32gui etc.
- Inject build constants PowerShell: reads file UTF8 via [IO.File]::ReadAllText, replaces API_URL regex `https://[^"]*` with env, BRIDGE_TOKEN placeholder, writes UTF8 without BOM.
- Sanity ast.parse file.
- Build pyinstaller --onefile --noconsole --name BakersWhisper --collect-submodules pyautogui pydirectinput psutil --hidden-import win32gui win32con win32api win32process pywintypes pkg_resources.py2_warn public/downloads/wim_bridge_gui.py
- Verify dist/BakersWhisper.exe exists size.
- Upload artifact BakersWhisper-Windows retention 30d if-no-files-found error.
- Create Release softprops/action-gh-release@v2 with files exe, name Bakers Whisper ${{ref_name}}, body instructions.
- Secrets needed: API_URL, BRIDGE_TOKEN.

---

## 10. DEPLOYMENT (Vercel + Neon)

- Vercel project wimmsg-lntm.
- Env vars: DATABASE_URL pooled string, BRIDGE_TOKEN strong random 32 hex.
- TeamId optional if in team.
- Build: Next.js auto.
- Need init-db POST /api/admin/init-db with admin token (BRIDGE_TOKEN) to create tables (or npx drizzle-kit push local with DATABASE_URL pointing to Neon).
- Health check /api/health public, masked DB URL, help text.
- Download page points to https://github.com/geleia328/wimmsg/releases/latest/download/BakersWhisper.exe (always latest).
- User flow: download exe from /download, open (SmartScreen More info -> Run anyway), open WoW windows, /chatlog each, exe lists windows, type Nome-Reino per slot, tick rename checkbox, click 💾 Salvar personagens (optional), click ▶ Iniciar, it renames windows to wowN, starts bridge (tailers+senders+scan+GSE sync+control sync), site /accounts shows wowN online, / shows chats, /gse controls.

---

## 11. TABELA VARIÁVEIS AMBIENTE

DATABASE_URL: Neon pooled connection postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require (incluir channel_binding=require se Neon gerar, mas site valida só sslmode=require). Deve ser Pooled, não Direct.

BRIDGE_TOKEN: token longo.

ADMIN_TOKEN: opcional, se definido usado para /settings e /api/admin/*, senão fallback BRIDGE_TOKEN.

---

## 12. PROBLEMAS COMUNS E SOLUÇÕES (do chat real)

- password auth failed for user neondb_owner => DATABASE_URL senha errada ou não pooled. Reset password no Neon Roles, copiar Pooled connection.
- relation messages does not exist => tabelas não criadas => /settings criar tabelas button ou npx drizzle-kit push.
- sem conexão com servidor no exe => health 500 DB erro ou token mismatch. App agora mostra health HTTP status + body, e auth check 401.
- bad screen distance "82" => Tkinter padding tuple bug fixed by using int.
- from __future__ imports must occur... => futuro import moved to top after docstring.
- git pull rebase unstaged => commit first git add . commit.
- failed to push some refs => pull --rebase.
- SmartScreen block => More info -> Run anyway.
- wow1 falsa => detect strict Wow.exe.
- rescan delete names => save by slot.
- GSE continua rodando => master GSE OFF stops all.
- delay volta => polling override, fixed with draft local + save button.
- whisper não envia se janela fechada => now pending not failed, waits.

---

## 13. ARQUITETURA DE FLUXO DETALHADA BUYER EXAMPLE

Seu char: taldoglaidon-gallywix (wow2)
Buyer: malaquias-gallywix

1. Buyer manda /w taldoglaidon-gallywix "oi quanto custa?"
2. WoW event CHAT_MSG_WHISPER (msg="oi...", sender="malaquias-gallywix")
3. WIMBridge addon: own=taldoglaidon-gallywix, from=malaquias-gallywix, line=[WIMBRIDGE]<OWN:taldoglaidon-gallywix><FROM:malaquias-gallywix>oi...
4. /chatlog escreve em Logs/WoWChatLog.txt
5. Python tail_file detecta linha, parse_whisper => (own=taldoglaidon-gallywix, from=malaquias-gallywix, body)
6. ingest => POST /api/ingest {character: taldoglaidon-gallywix, player: malaquias-gallywix, body, externalId, receivedAt}
7. Site DB inserts, /api/conversations agrupa por (taldoglaidon-gallywix, malaquias-gallywix)
8. UI ChatApp fetch /api/conversations mostra malaquias-gallywix com badge taldoglaidon-gallywix
9. Você digita resposta "500gold".
10. POST /api/conversations/taldoglaidon-gallywix/malaquias-gallywix {body}
11. DB pending.
12. Python outgoing_worker fetch queue sees pending, finds RuntimeCharacter taldoglaidon-gallywix hwnd wow2, pauses its GSE spammer, focus window wow2, wait focus delay, type /w malaquias-gallywix 500gold, wait after delay, unpause GSE, ack sent.
13. Buyer recebe no jogo.

Se wow2 fechado quando você respondeu, mensagem fica pending, não failed, e quando wow2 reabrir e mapear de novo como taldoglaidon-gallywix, envio acontece.

---

## 14. PROMPT PARA PRÓXIMO CHAT (COPIAR E COLAR)

Copie este bloco + anexe este arquivo docs/BAKERS_WHISPER_COMPLETE_HANDOFF.md como contexto. Diga para a IA ler o arquivo e reconstruir idêntico.

```
Você é um dev fullstack especialista em Next.js App Router + Drizzle ORM + PostgreSQL + Python Tkinter + PyInstaller + WoW Addon Lua.

Sua missão é recriar IDÊNTICO o projeto Bakers Whisper descrito em docs/BAKERS_WHISPER_COMPLETE_HANDOFF.md que estou enviando.

Requisitos obrigatórios:
- NÃO simplifique. Mantenha todos os endpoints, tabelas, colunas, indexes, nomes exatamente iguais.
- Frontend: Next.js 16, Tailwind, paginas / (chat), /accounts, /gse, /settings, /download, /setup, /report, /api/* todas listadas.
- Chat deve ter filtro pills com dot online, sidebar drawer responsivo? (próxima tarefa pendente é responsividade mobile, então após recriar idêntico, torne 100% responsivo mobile)
- Python GUI: tkinter dark, server settings card editável (API URL + Token + Salvar + Testar), detection rigorosa Wow.exe, slot wowN auto, rename checkbox, save personagens por slot, log, health check detalhado com status label, GSE spammer PostMessage com VK map, control sync, pending not failed.
- Addon Lua WIMBridge idêntico formato [WIMBRIDGE]<OWN><FROM>.
- GitHub Actions workflow build-windows.yml idêntico com secrets API_URL e BRIDGE_TOKEN, PyInstaller onefile noconsole.
- Auth: bridge aceita env BRIDGE_TOKEN ou app_settings bridge_token dinâmico, admin usa ADMIN_TOKEN fallback BRIDGE_TOKEN, dev mode permite se nenhum token.
- Validação final: npx next typegen, npm exec tsc --noEmit, npm run build, build_and_start devem passar.
- Repo: https://github.com/geleia328/wimmsg
- Site: https://wimmsg-lntm.vercel.app
- Versão atual objetivo v1.0.7 (eleve para v1.0.8 se adicionar mobile).

Primeiro leia o arquivo handoff que enviei, depois reconstrua tudo arquivo por arquivo usando as ferramentas create_file, edit_file.

Quando terminar, valide e faça build_and_start.

Vamos!
```

---

## 15. ESTADO ATUAL E PRÓXIMOS PASSOS NO MOMENTO DESTE RELATÓRIO

- Código no GitHub em geleia328/wimmsg main branch, última tag válida v1.0.4 ou v1.0.7 (depende do último push que deu verde no Actions). Usuário relatou build falha anteriormente por future import e bad screen distance, mas agora corrigido para v1.0.7.
- Site em Vercel online mas com possível health 500 se DATABASE_URL não corrigida ou tabelas não criadas. Usuário estava em tela Branch overview Databases tab travado.
- Relatórios criados: RELATORIO.md, RELATORIO_COMPLETO.md, BAKERS_WHISPER_COMPLETE_HANDOFF.md, HANDOFF_PROMPT.md.
- Pendência solicitada pelo usuário antes de encerrar: tornar site responsivo para mobile (ChatApp sidebar drawer, tabelas scroll, etc). Não implementado até este relatório; próximo chat deve fazer.
- O usuário quer arquivo para enviar pro GitHub: este arquivo `docs/BAKERS_WHISPER_COMPLETE_HANDOFF.md` é o arquivo único minucioso pronto.

---

## 16. NOTAS FINAIS DE SEGURANÇA

- DATABASE_URL e BRIDGE_TOKEN expostos anteriormente no chat (user postou). Instruído a rotacionar Neon password e gerar novo BRIDGE_TOKEN, atualizar Vercel env e GitHub Secrets.
- Token embutido no .exe pode ser extraído via strings. OK para uso privado.
- GSE e automação contra ToS Blizzard. Projeto não implementa anti-detecção, apenas delays de estabilidade técnica.

---

**FIM DO RELATÓRIO MINUCIOSO**
