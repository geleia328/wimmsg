# Hotfix WinOCR v1.4.4 — Bakers Whisper

## Problema

O executável antigo podia repetir no log:

```text
module 'winocr' has no attribute 'recognize_pil_image'
```

Isso acontece porque o código chamava uma API que **não existe** na versão de `winocr` empacotada pelo PyInstaller. A versão validada (`winocr==0.0.15`) expõe:

- `recognize_pil_sync(image, language)`
- `recognize_pil(image, language)`

Ela **não** expõe `recognize_pil_image`.

## Correção aplicada

Este projeto agora inclui o hotfix v1.4.4:

- `public/downloads/ocr_bridge.py` usa `recognize_pil_sync` quando disponível.
- Se precisar cair no async `recognize_pil`, ele envolve o WinRT `IAsyncOperation` dentro de uma coroutine antes de chamar `asyncio.run()`.
- `public/downloads/requirements.txt` fixa `winocr==0.0.15`.
- `scripts/patch_winocr_v144.py` corrige automaticamente um `public/downloads/wim_bridge_gui.py` antigo.

## Como aplicar no repositório original

No repositório que contém `public/downloads/wim_bridge_gui.py`, rode:

```bash
python scripts/patch_winocr_v144.py
```

Depois valide que a função inexistente saiu do código:

```bash
python - <<'PY'
from pathlib import Path
s = Path('public/downloads/wim_bridge_gui.py').read_text(encoding='utf-8')
assert 'recognize_pil_image' not in s
assert 'asyncio.run(call)' not in s
assert 'def ocr_recognize(' in s
print('WinOCR hotfix v1.4.4 OK')
PY
```

## Como gerar um novo .exe

Depois do patch:

```bash
git add .
git commit -m "fix: winocr v1.4.4 compatibility"
git tag v1.4.4
git push && git push --tags
```

O GitHub Actions deve compilar um novo `BakersWhisper.exe`.

## Recomendação para o workflow

No GitHub Actions, instale e valide `winocr==0.0.15`:

```powershell
pip install "winocr==0.0.15"
python -c "import winocr; assert callable(getattr(winocr, 'recognize_pil_sync', None)); assert callable(getattr(winocr, 'recognize_pil', None)); print('OCR API OK')"
```

E adicione uma verificação no source:

```powershell
python -c "from pathlib import Path; s=Path('public/downloads/wim_bridge_gui.py').read_text(encoding='utf-8'); assert 'recognize_pil_image' not in s; assert 'asyncio.run(call)' not in s; print('OCR source guard OK')"
```

## Observação importante

Se o usuário já baixou um `.exe` antigo, atualizar o site não corrige o binário que está no PC dele. É necessário gerar e baixar um **novo release** do `BakersWhisper.exe` contendo este hotfix.
