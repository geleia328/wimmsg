"""Windows window capture and OCR parsing for Bakers Whisper.

Hotfix v1.4.4:
- The old bridge called winocr.recognize_pil_image(), but winocr 0.0.15 does
  not expose that function.
- winocr 0.0.15 exposes recognize_pil_sync() and recognize_pil().
- recognize_pil() returns a WinRT IAsyncOperation, which is awaitable but is not
  a native coroutine accepted directly by asyncio.run(). We therefore wrap the
  operation inside a small coroutine before awaiting it.
"""

from __future__ import annotations

import ctypes
import re
from typing import Any

try:
    import win32con  # noqa: F401
    import win32gui
    import win32ui
    from PIL import Image, ImageEnhance
    import winocr

    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False
    winocr = None  # type: ignore[assignment]

# Supports both the old [WIMBRIDGE] marker and the v1.4 WIMRELAY marker.
RELAY_START_RE = re.compile(r"(?:\[?WIMBRIDGE\]?|WIMRELAY)", re.IGNORECASE)
RELAY_PAYLOAD_RE = re.compile(
    r"(?:\[?WIMBRIDGE\]?|WIMRELAY)\s*"
    r"<\s*OWN\s*:\s*(?P<own>[^>]+?)\s*>\s*"
    r"<\s*FROM\s*:\s*(?P<sender>[^>]+?)\s*>\s*"
    r"(?:<\s*TS\s*:\s*(?P<ts>\d+)\s*>\s*)?"
    r"(?P<body>.*?)(?=(?:\[?WIMBRIDGE\]?|WIMRELAY)\s*<|$)",
    re.IGNORECASE | re.DOTALL,
)
WIM_LINE_RE = re.compile(
    r"(?:^|\n)\s*(?:\d{1,2}\s*[:.]\s*\d{2}\s*)?"
    r"\[(?P<sender>[\wÀ-ÿ'’\- ]+)\]\s*[:;]\s*(?P<body>.+?)"
    r"(?=(?:\n\s*(?:\d{1,2}\s*[:.]\s*\d{2}\s*)?\[)|$)",
    re.IGNORECASE | re.DOTALL,
)


def _clean_name(value: str) -> str:
    value = value.replace("—", "-").replace("–", "-")
    value = re.sub(r"\s+", "", value)
    return value.strip("[] :;,. ")


def _clean_body(value: str) -> str:
    value = value.replace("\r", " ").replace("\n", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip(" \t\r\n |")


def _text(result: Any) -> str:
    """Normalize winocr result objects/dicts to plain text."""
    if isinstance(result, dict):
        return str(result.get("text", "") or "")
    return str(getattr(result, "text", result or "") or "")


def extract_relay_messages(text: str) -> list[dict[str, str]]:
    """Parse OCR text containing WIMRELAY markers, including wrapped names."""
    if not text or not RELAY_START_RE.search(text):
        return []
    normalized = text.replace("\r", "\n")
    normalized = re.sub(
        r"(?m)^\s*[\wÀ-ÿ'’-]+\s+(?=(?:\[?WIMBRIDGE\]?|WIMRELAY))",
        "",
        normalized,
    )
    normalized = re.sub(r"-\s*\n\s*", "-", normalized)
    normalized = normalized.replace("〉", ">").replace("〈", "<")

    found: list[dict[str, str]] = []
    for match in RELAY_PAYLOAD_RE.finditer(normalized):
        own = _clean_name(match.group("own"))
        sender = _clean_name(match.group("sender"))
        body = _clean_body(match.group("body"))
        timestamp = (match.group("ts") or "").strip()
        if own and sender and body and own.lower() != sender.lower():
            found.append(
                {
                    "character": own,
                    "player": sender,
                    "body": body,
                    "timestamp": timestamp,
                }
            )
    return found


def extract_wim_messages(text: str, character: str) -> list[dict[str, str]]:
    """Parse visible WIM lines such as `21:45 [Gasquatro]: agora vai`."""
    if not text:
        return []
    own_base = _clean_name(character).split("-", 1)[0].lower()
    realm = character.split("-", 1)[1] if "-" in character else ""
    normalized = text.replace("\r", "\n")
    normalized = re.sub(r"\n(?!\s*(?:\d{1,2}\s*[:.]\s*\d{2}\s*)?\[)", " ", normalized)

    found: list[dict[str, str]] = []
    for match in WIM_LINE_RE.finditer(normalized):
        sender = _clean_name(match.group("sender"))
        body = _clean_body(match.group("body"))
        if not sender or not body or sender.split("-", 1)[0].lower() == own_base:
            continue
        if "-" not in sender and realm:
            sender = f"{sender}-{realm}"
        found.append({"character": character, "player": sender, "body": body, "timestamp": ""})
    return found


def capture_window(hwnd: int):
    """Capture a window with PrintWindow; works when another window has focus."""
    if not OCR_AVAILABLE:
        raise RuntimeError("OCR indisponível: instale winocr, Pillow e pywin32")

    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width, height = max(1, right - left), max(1, bottom - top)
    window_dc = win32gui.GetWindowDC(hwnd)
    source_dc = win32ui.CreateDCFromHandle(window_dc)
    memory_dc = source_dc.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    bitmap.CreateCompatibleBitmap(source_dc, width, height)
    memory_dc.SelectObject(bitmap)
    try:
        # PW_RENDERFULLCONTENT = 2; supported on Windows 8.1+.
        rendered = ctypes.windll.user32.PrintWindow(hwnd, memory_dc.GetSafeHdc(), 2)
        if not rendered:
            rendered = ctypes.windll.user32.PrintWindow(hwnd, memory_dc.GetSafeHdc(), 0)
        if not rendered:
            raise RuntimeError("PrintWindow não conseguiu capturar a janela")
        info = bitmap.GetInfo()
        bits = bitmap.GetBitmapBits(True)
        return Image.frombuffer(
            "RGB",
            (info["bmWidth"], info["bmHeight"]),
            bits,
            "raw",
            "BGRX",
            0,
            1,
        ).copy()
    finally:
        win32gui.DeleteObject(bitmap.GetHandle())
        memory_dc.DeleteDC()
        source_dc.DeleteDC()
        win32gui.ReleaseDC(hwnd, window_dc)


def crop_relay_regions(image):
    """Return likely addon marker regions: lower chat and upper banner."""
    width, height = image.size
    return [
        image.crop((0, int(height * 0.62), int(width * 0.82), height)),
        image.crop((0, 0, width, int(height * 0.28))),
    ]


def crop_wim_region(image):
    """Crop the central WIM conversation window."""
    width, height = image.size
    return image.crop((int(width * 0.12), int(height * 0.10), int(width * 0.78), int(height * 0.82)))


def preprocess(image, scale: float = 1.35):
    """Improve colorful WoW text for Windows OCR while preserving glyph edges."""
    if not OCR_AVAILABLE:
        return image
    width, height = image.size
    image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    image = ImageEnhance.Contrast(image).enhance(1.35)
    image = ImageEnhance.Sharpness(image).enhance(1.5)
    return image.convert("RGB")


def recognize_image(image, language: str = "pt") -> str:
    """Recognize a PIL image using supported winocr APIs.

    Compatible with winocr 0.0.15 and PyInstaller builds:
    - Prefer recognize_pil_sync(prepared, language)
    - Fallback to async recognize_pil(prepared, language)
    - Never call removed/nonexistent recognize_pil_image()
    """
    if not OCR_AVAILABLE or winocr is None:
        raise RuntimeError("OCR indisponível: winocr/Pillow/pywin32 não foram empacotados")

    prepared = preprocess(image)
    languages: list[str | None] = []
    for candidate in (language, language.split("-", 1)[0] if "-" in language else language, "pt", "en", None):
        if candidate not in languages:
            languages.append(candidate)

    last_error: Exception | None = None

    sync = getattr(winocr, "recognize_pil_sync", None)
    if callable(sync):
        for lang in languages:
            try:
                result: Any = sync(prepared, lang) if lang else sync(prepared)
                return _text(result)
            except Exception as error:  # winocr may throw TypeError/RuntimeError per language
                last_error = error

    async_recognize = getattr(winocr, "recognize_pil", None)
    if callable(async_recognize):
        import asyncio

        for lang in languages:
            try:
                async def _await_operation():
                    operation = async_recognize(prepared, lang) if lang else async_recognize(prepared)
                    return await operation

                result = asyncio.run(_await_operation())
                return _text(result)
            except Exception as error:
                last_error = error

    exposed = ", ".join(x for x in dir(winocr) if x.startswith("recognize"))
    raise RuntimeError(
        "winocr incompatível: esperado recognize_pil_sync ou recognize_pil; "
        f"versão instalada expõe: {exposed}; último erro: {last_error}"
    )
