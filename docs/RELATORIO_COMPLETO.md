# Bakers Whisper — Relatório operacional v1.0.8

## Visão geral
Painel Next.js + PostgreSQL para centralizar whispers de múltiplas janelas do World of Warcraft. Um addon escreve eventos no chatlog; o bridge Windows faz tail, envia mensagens à API e executa respostas na janela correta.

## Componentes
- Chat responsivo com drawer mobile, filtros por personagem, notificações sonoras e desktop.
- Varredura de contas em `/accounts`, GSE em `/gse`, administração em `/settings`.
- Downloads e instruções em `/download` e `/setup`.
- APIs autenticadas para ingestão, fila, scan, controles e administração.
- PostgreSQL via Drizzle ORM: `messages`, `client_windows`, `gse_state`, `app_settings`.
- Bridge Tkinter v1.0.8, addon WIMBridge 2.0.0 e workflow PyInstaller.

## Fluxo
`CHAT_MSG_WHISPER → [WIMBRIDGE]<OWN><FROM> → WoWChatLog.txt → bridge → /api/ingest → Neon → painel`.
Respostas seguem `painel → pending → /api/queue → foco da janela → /w jogador mensagem → ack sent`.

## Operação
Configure `DATABASE_URL` pooled com `sslmode=require`, `BRIDGE_TOKEN` e opcionalmente `ADMIN_TOKEN`. Crie tabelas em `/settings`. Verifique `/api/health`. Mensagens destinadas a personagens sem janela permanecem pendentes.

## Segurança
Tokens são lidos de variáveis de ambiente. O token bridge também pode ser rotacionado dinamicamente no banco. Downloads usam allowlist. Automação de jogo pode contrariar termos da Blizzard.
