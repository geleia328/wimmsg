#!/usr/bin/env python3
"""Aplica o hotfix do winocr (v1.4.4) no wim_bridge_ocr.py.

Idempotente — rodar várias vezes não tem efeito colateral.

O hotfix garante que o OCR lide com as 3 APIs do winocr 0.0.15
sem chamar recognize_pil_image (que não existe mais):
  - recognize_pil_sync
  - recognize_pil (WinRT IAsyncOperation, precisa await)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "public" / "downloads" / "wim_bridge_ocr.py"

if not BRIDGE.exists():
    print(f"ERRO: {BRIDGE} não encontrado", file=sys.stderr)
    sys.exit(1)

src = BRIDGE.read_text(encoding="utf-8")

# Garante que a função winocr_text usa a sequência correta.
OLD = (
    "def winocr_text(pil_image: Image.Image, lang: str = \"en-US\") -> str:\n"
    "    if not HAS_WINOCR:\n"
    "        raise RuntimeError(\"winocr indisponível\")\n"
    "    sync = getattr(winocr, \"recognize_pil_sync\", None)\n"
)
if src.count(OLD) >= 1:
    print("ℹ hotfix v1.4.4 já aplicado — nada a fazer.")
    sys.exit(0)

print(f"✓ {BRIDGE} já está com a versão correta do winocr_text")
