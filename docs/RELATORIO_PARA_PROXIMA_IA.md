# Bakers Whisper — Relatório para próxima IA

Este documento descreve o estado do projeto Bakers Whisper. Veja também
`docs/HANDOFF_PROMPT.md` e `docs/RELATORIO_COMPLETO.md`.

- Stack: Next.js App Router + TypeScript + Tailwind + Drizzle + PostgreSQL + Python + Lua addon.
- Objetivo: painel estilo WhatsApp Web para whispers do WoW em múltiplas janelas.

## Componentes

- `src/app/` — rotas UI + `api/` REST endpoints.
- `src/components/ChatApp.tsx` — layout mensageiro responsivo.
- `src/components/GseView.tsx` — controle de spammers GSE.
- `src/components/AccountsView.tsx` — janelas WoW detectadas.
- `src/db/schema.ts` — tabelas `messages`, `client_windows`, `gse_state`, `app_settings`.
- `public/downloads/` — bridge Python + addon Lua.

## Regras críticas

1. Comparações de personagem/player sempre case-insensitive.
2. `/api/ingest` e `/api/sync` fazem parser defensivo do body para
   corrigir WIMRELAY/WIMBRIDGE embebido pelo bridge antigo.
3. `/api/conversations/bidirectional` é a fonte para o chat aberto.
4. Sequência de envio no bridge é fixa (foco→enter→/w→espaço→corpo→enter→esc).

Consulte o prompt de handoff completo na conversa original.
