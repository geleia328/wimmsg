# Bakers Whisper — Relatório completo

## Objetivo

Painel estilo WhatsApp Web para receber/responder whispers do WoW em
várias janelas ao mesmo tempo.

## Fluxo mensagem recebida

1. Amigo sussurra `Juper-Azralon`.
2. Addon WIMBridge captura `CHAT_MSG_WHISPER`.
3. Addon envia `WIMRELAY<OWN:Juper-Azralon><FROM:Cbsies-Azralon><TS:...>msg` em canal privado.
4. Addon força multi-flush do `/chatlog` (1.5s, 3s, 5s).
5. Bridge tail em `WoWChatLog.txt` lê a linha.
6. `parse_whisper` extrai OWN/FROM/BODY.
7. Bridge posta em `/api/ingest`.
8. Site salva `messages`.
9. `ChatApp` polling 500ms atualiza a conversa aberta.

## Fluxo mensagem enviada pelo site

1. Usuário digita e clica Enviar.
2. `POST /api/conversations/[character]/[player]` cria mensagem `pending`.
3. Bridge `GET /api/queue` encontra a mensagem.
4. Bridge foca janela do personagem correto.
5. Executa sequência foco→enter→`/w nome-realm`→espaço→corpo→enter→esc.
6. `POST /api/queue/[id]/ack` marca como `sent`.
7. Site mostra ✓✓.

## Rotas API

- `POST /api/ingest`, `POST /api/sync`
- `GET /api/queue`, `POST /api/queue/[id]/ack`
- `GET /api/conversations`
- `GET|POST|DELETE /api/conversations/[character]/[player]`
- `GET /api/conversations/bidirectional?charA=&charB=`
- `GET /api/characters`
- `GET /api/incoming/recent?sinceMs=`
- `GET /api/status`, `POST /api/status/scan`
- `GET /api/control`
- `GET|POST /api/admin/settings`
- `POST /api/admin/init-db`
- `GET /api/admin/vercel-env`
- `GET|POST /api/gse`, `GET|POST|DELETE /api/gse/[character]`
- `GET /api/download/[file]`

## Bugs históricos tratados

Nomes com caixa diferente separavam conversas → tudo usa `lower()`.
Body vinha com `WIMRELAY<...>` → parser defensivo no ingest/sync.
Delay GSE/keybind sobrescrito por polling → `charDirtyRef` no GseView.
