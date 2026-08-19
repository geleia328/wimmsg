"""Windows window capture and OCR parsing for Bakers Whisper."""
from __future__ import annotations

import ctypes
import re
from typing import Any

try:
    import win32con
    import win32gui
    import win32ui
    from PIL import Image, ImageEnhance, ImageOps
    import winocr
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

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
    r"\[\s*(?P<sender>[\wÀ-ÿ'’-]+(?:\s*-\s*[\wÀ-ÿ'’-]+)?)\s*\]\s*[:;]\s*"
    r"(?P<body>.+?)(?=(?:\n\s*(?:\d{1,2}\s*[:.]\s*\d{2}\s*)?\[)|$)",
    re.IGNORECASE | re.DOTALL,
)


def _clean_name(value: str) -> str:
    value = value.replace("—", "-").replace("–", "-")
    value = re.sub(r"\s+", "", value)
    return value.strip("[]<>:;,. ")


def _clean_body(value: str) -> str:
    value = value.replace("\r", " ").replace("\n", " ")
    value = re.sub(r"\s+", " ", value)
    # Remove common OCR debris at the end without destroying user punctuation.
    return value.strip(" \t\r\n<>|")


def extract_relay_messages(text: str) -> list[dict[str, str]]:
    """Parse OCR text containing WIMRELAY markers, including wrapped names."""
    if not text or not RELAY_START_RE.search(text):
        return []
    normalized = text.replace("\r", "\n")
    # WoW may prefix the marker with the local character name: `Simplat WIMRELAY...`.
    normalized = re.sub(r"(?m)^\s*[\wÀ-ÿ'’-]+\s+(?=(?:\[?WIMBRIDGE\]?|WIMRELAY))", "", normalized)
    # OCR frequently puts a line break after the realm separator.
    normalized = re.sub(r"-\s*\n\s*", "-", normalized)
    normalized = re.sub(r"<\s*\n\s*", "<", normalized)
    normalized = re.sub(r"\s*\n\s*>", ">", normalized)
    # Normalize frequent OCR substitutions around structural delimiters.
    normalized = normalized.replace("〈", "<").replace("〉", ">")
    found: list[dict[str, str]] = []
    for match in RELAY_PAYLOAD_RE.finditer(normalized):
        own = _clean_name(match.group("own"))
        sender = _clean_name(match.group("sender"))
        body = _clean_body(match.group("body"))
        timestamp = (match.group("ts") or "").strip()
        if own and sender and body and own.lower() != sender.lower():
            found.append({"character": own, "player": sender, "body": body, "timestamp": timestamp})
    return found


def extract_wim_messages(text: str, character: str) -> list[dict[str, str]]:
    """Parse visible WIM lines such as `21:45 [Gasquatro]: agora vai`."""
    if not text:
        return []
    own_base = _clean_name(character).split("-", 1)[0].lower()
    realm = character.split("-", 1)[1] if "-" in character else ""
    normalized = text.replace("\r", "\n")
    # Join only continuation lines; preserve lines which begin a new timestamp/message.
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
            "RGB", (info["bmWidth"], info["bmHeight"]), bits, "raw", "BGRX", 0, 1
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
    """Recognize a PIL image using the supported winocr APIs."""
    if not OCR_AVAILABLE:
        raise RuntimeError("OCR indisponível: winocr/Pillow/pywin32 não foram empacotados")
    prepared = preprocess(image)
    last_error = None
    sync = getattr(winocr, "recognize_pil_sync", None)
    if callable(sync):
        for lang in (language, "en", None):
            try:
                result: Any = sync(prepared, lang) if lang else sync(prepared)
                if isinstance(result, dict):
                    return str(result.get("text", ""))
                return str(getattr(result, "text", result or ""))
            except Exception as error:
                last_error = error
    async_recognize = getattr(winocr, "recognize_pil", None)
    if callable(async_recognize):
        import asyncio
        for lang in (language, "en", None):
            try:
                async def _await_operation():
                    operation = (
                        async_recognize(prepared, lang)
                        if lang
                        else async_recognize(prepared)
                    )
                    return await operation

                result = asyncio.run(_await_operation())
                if isinstance(result, dict):
                    return str(result.get("text", ""))
                return str(getattr(result, "text", result or ""))
            except Exception as error:
                last_error = error
    raise RuntimeError(
        "winocr incompatível: esperado recognize_pil_sync ou recognize_pil; "
        f"versão instalada expõe: {', '.join(x for x in dir(winocr) if x.startswith('recognize'))}; último erro: {last_error}"
    )
