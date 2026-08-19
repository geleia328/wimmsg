#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wim_bridge_stt.py — captura loopback da placa de som, faz VAD por energia,
transcreve com faster-whisper e devolve tuplas (character, player, body,
direction) para o wim_bridge.py enviar ao site.

Rota de dados:
  addon WIMBridge -> C_VoiceChat.SpeakText("bridge from C B S I E S dash A Z R A L O N says hello end")
  -> placa de som -> loopback WASAPI -> whisper -> parse -> ingest

Dependências opcionais (só se ligar STT):
    pip install soundcard faster-whisper numpy

Modelos recomendados:
  "small"    ~500MB, bom p/ inglês e latência ~1s em CPU.
  "medium"   ~1.5GB, melhor acurácia.
  "tiny.en"  ~75MB, muito rápido se só usar inglês.
"""
from __future__ import annotations

import os
import re
import sys
import time
import threading
import queue
from dataclasses import dataclass
from typing import Optional, Callable

# Imports lazy — só reclamam se STT for de fato ativado.
_np = None
_sc = None
_wh = None
_import_error: Optional[str] = None


def _lazy_imports():
    global _np, _sc, _wh, _import_error
    if _np and _sc and _wh:
        return True
    try:
        import numpy as np  # type: ignore
        import soundcard as sc  # type: ignore
        from faster_whisper import WhisperModel  # type: ignore
        _np = np
        _sc = sc
        _wh = WhisperModel
        return True
    except Exception as e:
        _import_error = f"{type(e).__name__}: {e}"
        return False


@dataclass
class SttConfig:
    enabled: bool = False
    model: str = "small"                 # tiny | tiny.en | small | small.en | medium | medium.en
    device: str = "cpu"                  # "cpu" ou "cuda"
    compute_type: str = "int8"           # int8 | int8_float16 | float16 | float32
    language: str = "en"                 # o addon fala em inglês estruturado
    samplerate: int = 16000
    channels: int = 1
    rms_threshold: float = 0.008         # energia mínima para começar utterance
    silence_ms: int = 700                # silêncio para fechar utterance
    max_utter_ms: int = 12000            # corte máximo por segurança
    min_utter_ms: int = 400              # descarta ruídos muito curtos
    device_name: str = ""                # nome parcial do speaker; vazio = default
    verbose: bool = True


@dataclass
class SttMessage:
    character: str
    player: str
    body: str
    direction: str  # "incoming" | "outgoing"
    text_raw: str


# ---------------------------------------------------------------------------
# Parser da frase falada
# ---------------------------------------------------------------------------
# Aceita variações de STT: "bridge from ... says ... end"
#   "from" pode virar "form", "for" — aceitamos alternativas.
#   "says" pode virar "sais", "sees" — aceitamos algumas.
#   "end" às vezes some — não obrigatório.
RE_TTS = re.compile(
    r"bridge\s+(?P<kind>from|form|for|to|too|two)\s+(?P<name>.+?)\s+(?:says?|sais|sees|sais|se)\s+(?P<body>.+?)(?:\s+end\.?)?\s*$",
    re.I,
)

# Dicionário fonético (letras + palavra "dash" para hífen).
# Aceita também soletração com variações comuns que o whisper produz.
LETTER_ALIASES = {
    # letra: variações que o whisper às vezes retorna
    "A": ["a", "ay", "eh"],
    "B": ["b", "be", "bee"],
    "C": ["c", "see", "sea", "cee", "ci"],
    "D": ["d", "de", "dee"],
    "E": ["e", "ee"],
    "F": ["f", "ef", "eff"],
    "G": ["g", "gee", "ge"],
    "H": ["h", "aitch", "eight"],
    "I": ["i", "eye"],
    "J": ["j", "jay"],
    "K": ["k", "kay"],
    "L": ["l", "el", "ell"],
    "M": ["m", "em"],
    "N": ["n", "en", "in"],
    "O": ["o", "oh", "ow"],
    "P": ["p", "pee", "pi"],
    "Q": ["q", "cue", "queue"],
    "R": ["r", "are", "ar"],
    "S": ["s", "es", "ess"],
    "T": ["t", "tee", "te"],
    "U": ["u", "you", "yew"],
    "V": ["v", "vee", "ve"],
    "W": ["w", "double u", "doubleyou"],
    "X": ["x", "ex", "eks"],
    "Y": ["y", "why", "wai"],
    "Z": ["z", "zee", "zed"],
}
DASH_ALIASES = {"dash", "hyphen", "hyphon", "minus", "-"}
SPACE_ALIASES = {"space"}

_TOKEN_MAP: dict[str, str] = {}
for letter, variants in LETTER_ALIASES.items():
    for v in variants:
        _TOKEN_MAP[v.lower()] = letter
for v in DASH_ALIASES:
    _TOKEN_MAP[v.lower()] = "-"
for v in SPACE_ALIASES:
    _TOKEN_MAP[v.lower()] = " "

# Ordem: variantes de dois tokens primeiro (ex: "double u")
_TOKEN_MAP_PAIRS = sorted(
    ((k, v) for k, v in _TOKEN_MAP.items() if " " in k),
    key=lambda kv: -len(kv[0]),
)
_TOKEN_MAP_SINGLE = {k: v for k, v in _TOKEN_MAP.items() if " " not in k}


def reassemble_name(spelled: str) -> str:
    """Junta 'C B S I E S dash A Z R A L O N' -> 'CBSIES-AZRALON'."""
    s = " " + spelled.lower().strip().replace(",", " ") + " "
    # substitui variantes de dois tokens primeiro
    for token, letter in _TOKEN_MAP_PAIRS:
        s = s.replace(" " + token + " ", " " + letter + " ")
    # agora tokens simples
    out = []
    for tok in s.split():
        tok_clean = tok.strip(".,;:!?")
        if not tok_clean:
            continue
        if tok_clean in _TOKEN_MAP_SINGLE:
            out.append(_TOKEN_MAP_SINGLE[tok_clean])
        elif len(tok_clean) == 1 and tok_clean.isalpha():
            out.append(tok_clean.upper())
        else:
            # heurística: se veio uma palavra inteira (ex: whisper acertou "Cbsies"),
            # inclui como está.
            out.append(tok_clean.upper())
    raw = "".join(out)
    raw = re.sub(r"-{2,}", "-", raw)
    raw = raw.strip("-")
    return raw


def _kind_to_direction(kind: str) -> str:
    k = kind.lower()
    if k in ("to", "too", "two"):
        return "outgoing"
    return "incoming"


def parse_spoken(text: str, own_character: str) -> Optional[SttMessage]:
    if not text:
        return None
    m = RE_TTS.search(text)
    if not m:
        return None
    kind = m.group("kind")
    spelled = m.group("name")
    body = m.group("body").strip()
    # remove sufixo "end" perdido
    body = re.sub(r"\s+end\.?$", "", body, flags=re.I).strip()
    if not body:
        return None
    player = reassemble_name(spelled)
    if not player:
        return None
    direction = _kind_to_direction(kind)
    return SttMessage(
        character=own_character or "unknown",
        player=player,
        body=body,
        direction=direction,
        text_raw=text.strip(),
    )


# ---------------------------------------------------------------------------
# Captura de áudio com VAD por energia
# ---------------------------------------------------------------------------
class LoopbackCapture:
    def __init__(self, cfg: SttConfig, on_utterance: Callable[[bytes, int], None], log=print):
        self.cfg = cfg
        self.on_utterance = on_utterance
        self.log = log
        self.stop_event = threading.Event()

    def start(self):
        threading.Thread(target=self._run, daemon=True).start()

    def stop(self):
        self.stop_event.set()

    def _pick_loopback_mic(self):
        speaker = _sc.default_speaker()
        wanted = self.cfg.device_name.strip().lower()
        candidates = _sc.all_microphones(include_loopback=True)
        if wanted:
            for m in candidates:
                if wanted in m.name.lower():
                    return m
        # tenta bater com o nome do speaker default
        target = speaker.name.lower()
        for m in candidates:
            if target in m.name.lower() and getattr(m, "isloopback", False):
                return m
        # fallback: primeiro loopback disponível
        for m in candidates:
            if getattr(m, "isloopback", False):
                return m
        return _sc.default_microphone()

    def _run(self):
        if not _lazy_imports():
            self.log(f"[stt] dependências ausentes ({_import_error}). Instale: pip install soundcard faster-whisper numpy")
            return
        try:
            mic = self._pick_loopback_mic()
        except Exception as e:
            self.log(f"[stt] não consegui achar loopback: {e}")
            return
        self.log(f"[stt] captura loopback: {mic.name}")

        sr = self.cfg.samplerate
        chunk_samples = int(sr * 0.1)   # janelas de 100 ms
        silence_frames = max(1, int(self.cfg.silence_ms / 100))
        max_frames = max(silence_frames + 1, int(self.cfg.max_utter_ms / 100))
        min_frames = max(1, int(self.cfg.min_utter_ms / 100))

        try:
            with mic.recorder(samplerate=sr, channels=self.cfg.channels) as r:
                buffer: list = []
                silent = 0
                talking = False
                while not self.stop_event.is_set():
                    data = r.record(numframes=chunk_samples)
                    # data shape: (n, channels)
                    mono = data.mean(axis=1) if data.ndim == 2 else data
                    rms = float(_np.sqrt(_np.mean(mono.astype(_np.float32) ** 2)) + 1e-9)
                    if rms >= self.cfg.rms_threshold:
                        if not talking:
                            talking = True
                            buffer = []
                        buffer.append(mono.astype(_np.float32))
                        silent = 0
                        if len(buffer) >= max_frames:
                            self._flush(buffer, sr)
                            buffer = []
                            talking = False
                            silent = 0
                    else:
                        if talking:
                            silent += 1
                            buffer.append(mono.astype(_np.float32))
                            if silent >= silence_frames:
                                if len(buffer) >= min_frames:
                                    self._flush(buffer, sr)
                                buffer = []
                                talking = False
                                silent = 0
        except Exception as e:
            self.log(f"[stt] captura interrompida: {e}")

    def _flush(self, buffer, sr: int):
        audio = _np.concatenate(buffer).astype(_np.float32)
        # normaliza para -1..1 (soundcard já entrega float, mas garantimos)
        peak = float(_np.max(_np.abs(audio)) + 1e-9)
        if peak > 1.0:
            audio = audio / peak
        try:
            self.on_utterance(audio.tobytes(), sr)
        except Exception as e:
            self.log(f"[stt] on_utterance erro: {e}")


# ---------------------------------------------------------------------------
# Transcritor (faster-whisper)
# ---------------------------------------------------------------------------
class WhisperTranscriber:
    def __init__(self, cfg: SttConfig, log=print):
        self.cfg = cfg
        self.log = log
        self.model = None
        self.q: "queue.Queue[tuple[bytes,int]]" = queue.Queue()
        self.on_text: Optional[Callable[[str], None]] = None
        self.stop_event = threading.Event()

    def start(self, on_text: Callable[[str], None]):
        self.on_text = on_text
        threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, pcm_bytes: bytes, sr: int):
        self.q.put((pcm_bytes, sr))

    def _load_model(self):
        if self.model is not None:
            return True
        if not _lazy_imports():
            self.log(f"[stt] dependências ausentes ({_import_error}).")
            return False
        self.log(f"[stt] carregando modelo whisper: {self.cfg.model} ({self.cfg.device}/{self.cfg.compute_type})...")
        try:
            self.model = _wh(self.cfg.model, device=self.cfg.device, compute_type=self.cfg.compute_type)
            self.log("[stt] modelo pronto.")
            return True
        except Exception as e:
            self.log(f"[stt] falha carregando modelo: {e}")
            return False

    def _worker(self):
        if not self._load_model():
            return
        while not self.stop_event.is_set():
            try:
                pcm, sr = self.q.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                audio = _np.frombuffer(pcm, dtype=_np.float32)
                segments, _info = self.model.transcribe(
                    audio,
                    language=self.cfg.language or None,
                    beam_size=1,
                    vad_filter=False,
                    condition_on_previous_text=False,
                )
                text = " ".join(s.text.strip() for s in segments).strip()
                if text and self.on_text:
                    if self.cfg.verbose:
                        self.log(f"[stt] «{text}»")
                    self.on_text(text)
            except Exception as e:
                self.log(f"[stt] transcrição falhou: {e}")


# ---------------------------------------------------------------------------
# Orquestrador: junta captura + transcrição + parser
# ---------------------------------------------------------------------------
class SttPipeline:
    """
    Uso:
        cfg = SttConfig(enabled=True)
        pipe = SttPipeline(cfg, own_character_provider=lambda: "Juper-Azralon",
                           on_message=lambda m: print(m))
        pipe.start()
    """
    def __init__(
        self,
        cfg: SttConfig,
        own_character_provider: Callable[[], str],
        on_message: Callable[[SttMessage], None],
        log=print,
    ):
        self.cfg = cfg
        self.own = own_character_provider
        self.on_message = on_message
        self.log = log
        self.transcriber = WhisperTranscriber(cfg, log=log)
        self.capture = LoopbackCapture(cfg, on_utterance=self._on_audio, log=log)
        self._recent_texts: list[tuple[float, str]] = []

    def start(self):
        if not self.cfg.enabled:
            return
        self.transcriber.start(on_text=self._on_text)
        self.capture.start()

    def stop(self):
        self.capture.stop()
        self.transcriber.stop_event.set()

    def _on_audio(self, pcm_bytes: bytes, sr: int):
        self.transcriber.submit(pcm_bytes, sr)

    def _on_text(self, text: str):
        # Dedupe simples de textos repetidos em 5s
        now = time.time()
        self._recent_texts = [(t, s) for (t, s) in self._recent_texts if now - t < 5.0]
        norm = text.lower().strip()
        for t, s in self._recent_texts:
            if s == norm:
                return
        self._recent_texts.append((now, norm))
        msg = parse_spoken(text, self.own() or "unknown")
        if msg is None:
            if self.cfg.verbose:
                self.log(f"[stt] fala não bateu com padrão bridge: «{text}»")
            return
        try:
            self.on_message(msg)
        except Exception as e:
            self.log(f"[stt] on_message erro: {e}")


# ---------------------------------------------------------------------------
# CLI de teste rápido
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute", default="int8")
    ap.add_argument("--language", default="en")
    ap.add_argument("--character", default="Tester-Local")
    ap.add_argument("--test-parse", default=None, help="testa parser com texto (ex: 'bridge from C B S I E S dash A Z R A L O N says hello end')")
    args = ap.parse_args()
    if args.test_parse:
        m = parse_spoken(args.test_parse, args.character)
        print(m)
        sys.exit(0)
    cfg = SttConfig(enabled=True, model=args.model, device=args.device, compute_type=args.compute, language=args.language)
    pipe = SttPipeline(cfg, own_character_provider=lambda: args.character, on_message=lambda m: print(m))
    pipe.start()
    print("[stt] ouvindo (Ctrl+C p/ sair)...")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pipe.stop()
        print("bye")
