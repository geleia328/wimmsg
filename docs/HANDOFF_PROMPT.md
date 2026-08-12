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
