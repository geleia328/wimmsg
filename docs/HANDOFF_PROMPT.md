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
6. Após reconstruir, o próximo passo pendente é **responsividade mobile** para todas as páginas.

**Relatório completo (cole aqui):**

```
--- COLE AQUI O CONTEÚDO INTEIRO DE docs/RELATORIO_COMPLETO.md ---
```

Se você não tiver o arquivo, use esta versão resumida: repositório https://github.com/geleia328/wimmsg tem todo código. Site wimmsg-lntm.vercel.app . Usar Neon pooled connection string DATABASE_URL + BRIDGE_TOKEN. Python GUI em public/downloads/wim_bridge_gui.py com detecção EnumWindows, slot assign, rename SetWindowText, tail WoWChatLog.txt, parse [WIMBRIDGE]<OWN><FROM>, GSE spammer PostMessage, control sync, health/auth check.

**Tarefas imediatas após recriar:**
- Garantir que relatório em /report serve docs/RELATORIO_COMPLETO.md
- Tornar site 100% responsivo mobile (ChatApp drawer, Accounts table scroll, GSE single col, etc.)
- Validar build.

Obrigado!
