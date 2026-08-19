#!/usr/bin/env python3
"""Apply Bakers Whisper WinOCR hotfix v1.4.4.

Usage from repository root:
    python scripts/patch_winocr_v144.py

What it fixes:
- Replaces the nonexistent winocr.recognize_pil_image(...) call.
- Adds a robust OCR helper compatible with winocr==0.0.15.
- Handles WinRT IAsyncOperation correctly by awaiting it inside a coroutine.
- Bumps APP_VERSION to 1.4.4 when possible.

This script is intentionally idempotent: running it more than once is safe.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "public" / "downloads" / "wim_bridge_gui.py"
OCR_BRIDGE = ROOT / "public" / "downloads" / "ocr_bridge.py"

OCR_HELPER = r'''

def _bw_ocr_text(result):
    """Normalize winocr result objects/dicts to plain text."""
    if isinstance(result, dict):
        return str(result.get("text", "") or "")
    return str(getattr(result, "text", result or "") or "")


def ocr_recognize(image, language: str = "en-US") -> str:
    """Recognize a PIL image using supported winocr APIs.

    Hotfix v1.4.4:
    winocr 0.0.15 does NOT expose recognize_pil_image(). It exposes:
      - recognize_pil_sync(image, language)
      - recognize_pil(image, language) -> WinRT IAsyncOperation

    IAsyncOperation is awaitable, but asyncio.run() cannot receive it directly,
    so the async path creates a tiny coroutine and awaits the operation inside.
    """
    if not HAS_WINOCR or winocr is None:
        raise RuntimeError("winocr não está disponível neste executável")

    langs = []
    for candidate in (
        language,
        language.split("-", 1)[0] if "-" in language else language,
        "pt-BR",
        "pt",
        "en-US",
        "en",
        None,
    ):
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
    raise RuntimeError(
        "winocr incompatível: esperado recognize_pil_sync ou recognize_pil; "
        f"APIs expostas: {exposed}; último erro: {last_error}"
    )
'''


def patch_bridge_source(source: str) -> tuple[str, list[str]]:
    changes: list[str] = []

    source2 = re.sub(
        r'APP_VERSION\s*=\s*"[^"]+"',
        'APP_VERSION = "1.4.4"',
        source,
        count=1,
    )
    if source2 != source:
        changes.append("APP_VERSION -> 1.4.4")
    source = source2

    if "def ocr_recognize(image" not in source:
        anchor = "try:\n    import psutil"
        if anchor in source:
            source = source.replace(anchor, OCR_HELPER + "\n" + anchor, 1)
            changes.append("added ocr_recognize helper")
        else:
            raise RuntimeError("could not find insertion point before psutil import")

    # Replace the specific obsolete async call pattern used by v1.4.2/v1.4.3.
    patterns = [
        (
            r'result\s*=\s*asyncio\.run\(winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)\)\s*\n\s*text\s*=\s*getattr\(result,\s*"text",\s*None\)\s*or\s*str\(result\)',
            r'text = ocr_recognize(\1, "\2")',
        ),
        (
            r'result\s*=\s*asyncio\.run\(winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)\)\s*\n\s*text\s*=\s*getattr\(result,\s*"text",\s*""\)\s*or\s*str\(result\)',
            r'text = ocr_recognize(\1, "\2")',
        ),
        (
            r'asyncio\.run\(winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)\)',
            r'ocr_recognize(\1, "\2")',
        ),
        (
            r'winocr\.recognize_pil_image\(([^,]+),\s*"([^"]+)"\)',
            r'ocr_recognize(\1, "\2")',
        ),
    ]

    for pattern, repl in patterns:
        source, n = re.subn(pattern, repl, source)
        if n:
            changes.append(f"replaced obsolete recognize_pil_image pattern ({n})")

    # No longer needed in OCR workers if it was only used for the obsolete call.
    source, n = re.subn(r'\n\s*import asyncio\n\s*from PIL import Image', '\n        from PIL import Image', source)
    if n:
        changes.append(f"removed local import asyncio before PIL ({n})")

    if "recognize_pil_image" in source:
        raise RuntimeError("hotfix incomplete: recognize_pil_image still present")

    if "asyncio.run(call)" in source:
        raise RuntimeError("hotfix incomplete: asyncio.run(call) still present")

    return source, changes


def patch_ocr_bridge(source: str) -> tuple[str, list[str]]:
    changes: list[str] = []
    if "asyncio.run(call)" not in source and "async def _await_operation" in source:
        return source, ["ocr_bridge.py already patched"]

    source = source.replace(
        "result = asyncio.run(call)\n                return str(getattr(result, \"text\", result or \"\"))",
        "async def _await_operation():\n                    operation = async_recognize(prepared, lang) if lang else async_recognize(prepared)\n                    return await operation\n\n                result = asyncio.run(_await_operation())\n                if isinstance(result, dict):\n                    return str(result.get(\"text\", \"\"))\n                return str(getattr(result, \"text\", result or \"\"))",
    )
    source = source.replace("call = async_recognize(prepared, lang) if lang else async_recognize(prepared)\n                ", "")
    source = source.replace(
        "except (TypeError, ValueError, RuntimeError) as error:",
        "except Exception as error:",
    )
    source = source.replace(
        "f\"versão instalada expõe: {', '.join(x for x in dir(winocr) if x.startswith('recognize'))}\"",
        "f\"versão instalada expõe: {', '.join(x for x in dir(winocr) if x.startswith('recognize'))}; último erro: {last_error}\"",
    )
    changes.append("patched ocr_bridge async WinRT awaitable path")
    return source, changes


def main() -> None:
    all_changes: list[str] = []

    if BRIDGE.exists():
        original = BRIDGE.read_text(encoding="utf-8")
        patched, changes = patch_bridge_source(original)
        if patched != original:
            BRIDGE.write_text(patched, encoding="utf-8", newline="\n")
        all_changes.extend([f"wim_bridge_gui.py: {c}" for c in changes])
    else:
        all_changes.append("wim_bridge_gui.py not found; skipped bridge source patch")

    if OCR_BRIDGE.exists():
        original = OCR_BRIDGE.read_text(encoding="utf-8")
        patched, changes = patch_ocr_bridge(original)
        if patched != original:
            OCR_BRIDGE.write_text(patched, encoding="utf-8", newline="\n")
        all_changes.extend([f"ocr_bridge.py: {c}" for c in changes])
    else:
        all_changes.append("ocr_bridge.py not found; skipped OCR helper patch")

    print("Bakers Whisper WinOCR hotfix v1.4.4")
    for change in all_changes:
        print("-", change)
    print("OK")


if __name__ == "__main__":
    main()
