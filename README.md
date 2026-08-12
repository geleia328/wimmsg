# 🥐 Bakers Whisper

Painel web para agregar e responder whispers do World of Warcraft de várias
janelas ao mesmo tempo, direto do navegador.

- 🖥️ Interface tipo WhatsApp Web
- 🪟 Multi-janela (20+ personagens ao mesmo tempo)
- 📡 Varredura ao vivo das contas WoW abertas no seu PC
- 🔔 Notificações sonoras
- 🐍 Bridge em Python que roda no seu PC

---

## 🚀 Como subir no GitHub (passo a passo)

Se você nunca usou Git, siga esses passos exatos:

### 1. Instale o Git no seu PC

- **Windows:** baixe em [git-scm.com](https://git-scm.com/download/win) e
  instale com as opções padrão.
- **Mac:** rode `xcode-select --install` no Terminal.
- **Linux:** `sudo apt install git` ou o equivalente da sua distro.

Verifique com:
```bash
git --version
```

### 2. Crie uma conta no GitHub

Se ainda não tem: [github.com/signup](https://github.com/signup) — é grátis.

### 3. Crie um repositório vazio no GitHub

1. Acesse [github.com/new](https://github.com/new)
2. **Repository name:** `bakers-whisper`
3. Marque **Private** (recomendado — evita expor seu setup)
4. **NÃO marque** nenhuma das opções "Initialize with README/gitignore/license"
   (deixe tudo desmarcado — nosso projeto já traz esses arquivos)
5. Clique em **Create repository**

O GitHub vai mostrar uma tela com comandos. **Ignore essa tela** e siga
os passos abaixo — são mais fáceis.

### 4. Configure sua identidade Git (só uma vez por PC)

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu@email.com"
```

### 5. Prepare o projeto para enviar

Abra o terminal na pasta do projeto (onde está o `package.json`) e rode:

```bash
git init
git add .
git commit -m "Bakers Whisper: primeira versão"
git branch -M main
```

### 6. Conecte ao GitHub

Cole o comando abaixo trocando `SEU_USUARIO` pelo seu nome de usuário do
GitHub:

```bash
git remote add origin https://github.com/SEU_USUARIO/bakers-whisper.git
git push -u origin main
```

Na primeira vez o GitHub vai pedir autenticação. **Não use sua senha**
(o GitHub descontinuou isso). Use um **Personal Access Token**:

1. Vá em [github.com/settings/tokens](https://github.com/settings/tokens)
2. **Generate new token → Generate new token (classic)**
3. Nome: `bakers-whisper`, validade: 90 dias
4. Marque a permissão `repo` (marca todos os sub-itens)
5. Clique **Generate token** no fim da página
6. **Copie o token** (só aparece uma vez!) e cole quando o Git pedir a senha

Pronto — recarregue a página do GitHub e seu código estará lá! 🎉

---

## 🌩️ Depois de subir: deploy grátis na Vercel

1. Acesse [vercel.com/signup](https://vercel.com/signup) → **Continue with GitHub**
2. **Add New… → Project** → escolha o repositório `bakers-whisper`
3. Antes de clicar em Deploy, expanda **Environment Variables** e adicione:

   | Nome           | Valor                                                    |
   | -------------- | -------------------------------------------------------- |
   | `DATABASE_URL` | Pooled connection string do [Neon](https://neon.tech)   |
   | `BRIDGE_TOKEN` | Um token aleatório: `openssl rand -hex 32`               |

4. Clique **Deploy** e aguarde ~2 min

Seu site estará em `https://bakers-whisper.vercel.app`.

Depois do primeiro deploy, rode **uma vez** no seu PC (com o
`DATABASE_URL` do Neon no `.env`) para criar as tabelas:

```bash
npx drizzle-kit push
```

---

## 💻 Rodando localmente

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>.

Para o Python bridge, veja instruções completas em `/setup` no site.

---

## 🐍 Bridge Python (roda no seu PC junto com o WoW)

Faça o download dos arquivos em `/setup` do site:

- `wim_bridge.py`
- `requirements.txt`
- `config.example.ini`

Instale e configure:

```bash
pip install -r requirements.txt
cp config.example.ini config.ini
# edite config.ini com seus personagens
python wim_bridge.py
```

Adicione um bloco `[character:Nome-Reino]` no `config.ini` para cada
janela do WoW aberta.

---

## ⚠️ Aviso legal

Este projeto é uma ferramenta pessoal de conveniência. Automatizar input
em jogos online viola o ToS da Blizzard. O modo somente-leitura (só
agregar whispers, responder manualmente no jogo) tem risco praticamente
zero. Use com bom senso.
