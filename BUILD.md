# 🥐 Bakers Whisper — Build & Release

Este documento explica como o `.exe` é gerado automaticamente pelo GitHub.

## Fluxo

```
┌─────────────────────┐    git push     ┌──────────────────────┐
│ Você edita o código │ ──────────────▶ │ GitHub Actions       │
│ (.py, .lua, etc.)   │                 │ (Windows runner)     │
└─────────────────────┘                 └──────────┬───────────┘
                                                   │
                                ┌──────────────────▼──────────────┐
                                │ 1) pip install -r requirements   │
                                │ 2) pyinstaller wim_bridge.spec   │
                                │ 3) Gera dist/BakersWhisper.exe   │
                                └──────────────────┬──────────────┘
                                                   │
                                ┌──────────────────▼──────────────┐
                                │ GitHub Release (latest)          │
                                │ github.com/USER/REPO/releases/   │
                                │   latest/download/BakersWhisper  │
                                │   .exe                           │
                                └──────────────────┬──────────────┘
                                                   │
                                ┌──────────────────▼──────────────┐
                                │ BRIDGE_EXE_URL no .env do site   │
                                │ Botão "/setup" do painel         │
                                └─────────────────────────────────┘
```

## Configurar uma vez (no GitHub)

### 1. Permissões de escrita
O workflow precisa criar Releases. Em **Settings → Actions → General**:
- **Workflow permissions**: `Read and write permissions` ✓
- **Allow GitHub Actions to create and approve pull requests** ✓ (opcional)

### 2. Secrets (opcional)
Se você quiser que o `.exe` já venha com URL/token pré-configurados, em
**Settings → Secrets and variables → Actions**, crie:

| Secret | Valor | Efeito |
|---|---|---|
| `API_URL` | `https://seu-site.vercel.app` | O .exe abre já apontando pro site |
| `BRIDGE_TOKEN` | mesmo token do site | O .exe já autentica de cara |

Sem secrets, o `.exe` abre com a janelinha em branco e o usuário preenche
na primeira execução. **As duas formas funcionam**, é só conveniência.

### 3. Variável no site (Vercel)
No painel da Vercel (ou seu `.env` local), defina:

```bash
BRIDGE_EXE_URL=https://github.com/SEU_USUARIO/SEU_REPO/releases/latest/download/BakersWhisper.exe
```

Pronto. O botão **"⬇ Baixar BakersWhisper.exe"** em `/setup` já vai
apontar pra release mais recente.

## Como disparar um build

### Automático (recomendado)
```bash
git add .
git commit -m "feat: novo comando no addon"
git push origin main
```

Em ~5-8 minutos o `.exe` está na release. O site já passa a servir o
link novo (o download é por redirect, sem rebuild do site).

### Manual (sem release)
Em **Actions → Build BakersWhisper.exe → Run workflow**, marque
"Apenas buildar, não publicar release". Útil pra testar.

### Versão estável (release versionada)
```bash
git tag v1.2.3
git push origin v1.2.3
```

Cria uma release `v1.2.3` separada da "latest". Use para marcos
importantes (mudança grande, correção crítica).

## Rodar localmente (Windows)

Se você quiser compilar localmente sem o GitHub:

```bash
git clone https://github.com/SEU_USUARIO/bakers-whisper
cd bakers-whisper
pip install -r public/downloads/requirements.txt
pip install pyinstaller==6.11.1
pyinstaller wim_bridge.spec
# binário em dist/BakersWhisper.exe
```

Ou o caminho curto:
```bash
pyinstaller --onefile --noconsole --name BakersWhisper \
  --collect-all winocr --collect-submodules winrt \
  --hidden-import winrt.windows.media.ocr \
  public/downloads/wim_bridge_ocr.py
```

## Troubleshooting

**O workflow falha em "Install bridge dependencies"**
- Causa mais comum: `winocr==0.0.15` precisa de WinRT que às vezes não
  está disponível no runner. Tente fixar a versão do Python em 3.11
  (que é o que está no yml).

**O `.exe` é muito grande (>100 MB)**
- Normal. PyInstaller onefile + winocr + winrt = ~80-120 MB.
  Para reduzir: use `--exclude-module` pra módulos que você não usa.

**O `.exe` abre e fecha imediatamente**
- Falta o pywin32. Adicione `pywin32-ctypes` no requirements ou
  reinstale o `.exe` (PyInstaller está coletando mas pode ter perdido
  alguma DLL).

**O usuário clica no botão e recebe 404**
- A `BRIDGE_EXE_URL` no `.env` está errada OU a release "latest" não
  existe ainda. Vá em **Releases** do seu GitHub e veja se a release
  automática foi criada.

## Estrutura dos arquivos

```
.github/workflows/build-windows.yml   ← workflow do GitHub Actions
wim_bridge.spec                       ← spec do PyInstaller
public/downloads/
  wim_bridge_ocr.py                   ← código-fonte do .exe
  WIMBridge.lua                       ← addon v3.3.0
  WIMBridge.toc
  requirements.txt
scripts/
  patch_winocr_v144.py                ← hotfix do winocr (idempotente)
src/app/
  api/download/[file]/route.ts        ← servidor de downloads do site
  setup/page.tsx                      ← página /setup com botão do .exe
```
