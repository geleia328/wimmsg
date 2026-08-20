#!/usr/bin/env python3
"""Apply Bakers Whisper WinOCR hotfix v1.4.4.

Download this file into the repository root and run:
    python patch_winocr_v144.py

It patches public/downloads/wim_bridge_gui.py when present and verifies that
obsolete winocr.recognize_pil_image() calls are gone.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()
BRIDGE = ROOT / "public" / "downloads" / "wim_bridge_gui.py"

OCR_HELPER = r'''

def _bw_ocr_text(result):
    if isinstance(result, dict):
        return str(result.get("text", "") or "")
    return str(getattr(result, "text", result or "") or "")


def ocr_recognize(image, language: str = "en-US") -> str:
    if not HAS_WINOCR or winocr is None:
        raise RuntimeError("winocr não está disponível neste executável")
    langs = []
    for candidate in (language, language.split("-", 1)[0] if "-" in language else language, "pt-BR", "pt", "en-US", "en", None):
        if candidate not in langs:
            langs.append(candidate)
    last_error = None
    sync_recognize = getattr(winocr, "recognize_pil_sync", None)
    if callable(sync_recognize):
        for lang in langs:
            try:
                result = sync_recognize(image, lang) if lang else sync_recognize(image)
                return _bw_ocr_text(result)
            except Exception as error:
                last_error = error
    async_recognize = getattr(winocr, "recognize_pil", None)
    if callable(async_recognize):
        import asyncio
        for lang in langs:
            try:
                async def _await_operation():
                    operation = async_recognize(image, lang) if lang else async_recognize(image)
                    return await operation
                return _bw_ocr_text(asyncio.run(_await_operation()))
            except Exception as error:
                last_error = error
    exposed = ", ".join(name for name in dir(winocr) if name.startswith("recognize"))
    raise RuntimeError(f"winocr incompatível: esperado recognize_pil_sync ou recognize_pil; APIs expostas: {exposed}; último erro: {last_error}")
'''


def main() -> None:
    if not BRIDGE.exists():
        raise SystemExit(f"Arquivo não encontrado: {BRIDGE}")
    source = BRIDGE.read_text(encoding="utf-8")
    source = re.sub(r'APP_VERSION\s*=\s*"[^"]+"', 'APP_VERSION = "1.4.4"', source, count=1)
    if "def ocr_recognize(image" not in source:
        anchor = "try:\n    import psutil"
        if anchor not in source:
            raise SystemExit("Não achei o ponto de inserção antes do import psutil")
        source = source.replace(anchor, OCR_HELPER + "\n" + anchor, 1)
    source = re.sub(
        r'result\s*=\s*asyncio\.run\(winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)\)\s*\n\s*text\s*=\s*getattr\(result,\s*"text",\s*(?:None|"")\)\s*or\s*str\(result\)',
        r'text = ocr_recognize(\1, "\2")',
        source,
    )
    source = re.sub(
        r'asyncio\.run\(winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)\)',
        r'ocr_recognize(\1, "\2")',
        source,
    )
    source = re.sub(
        r'winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)',
        r'ocr_recognize(\1, "\2")',
        source,
    )
    if "recognize_pil_image" in source:
        raise SystemExit("Hotfix incompleto: recognize_pil_image ainda aparece no arquivo")
    if "asyncio.run(call)" in source:
        raise SystemExit("Hotfix incompleto: asyncio.run(call) ainda aparece no arquivo")
    BRIDGE.write_text(source, encoding="utf-8", newline="\n")
    print("WinOCR hotfix v1.4.4 aplicado com sucesso")


if __name__ == "__main__":
    main()
