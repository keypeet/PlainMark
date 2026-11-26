"""Speech to text for meeting recordings with Whisper large-v3-turbo (OpenVINO GenAI, Arc GPU).

Silero VAD cuts the audio at pauses into pieces of at most 28 s and each piece is transcribed
on its own: fed whole, Whisper invents repeated words over long silences (spike 2026-11-24,
RTF 0.071 on the GPU). No initial prompt or hotwords: with this model they make it translate
whole Thai lines into English. A piece still caught in a loop ("การการการ…", 5 of 312 pieces
on a 52 min meeting) is decoded again with a repetition penalty, which recovered all five.

Both models live outside the repo, in config.asr_model_dir(). Install them with:

    uv run --directory backend python -m app.asr install            # download from Hugging Face
    uv run --directory backend python -m app.asr install --from DIR # copy a Whisper folder

Silero VAD (2 MB) is always downloaded.
"""

from __future__ import annotations

import argparse
import re
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import config, diarize, ocr

MODEL_REPO = "OpenVINO/whisper-large-v3-turbo-fp16-ov"
MODEL_REVISION = "0250c28d68c7c10d6b5cb39707e876c0c66ab6f8"
MODEL_FILES = {
    "added_tokens.json": "3c51f66c4c21f9e126970078f11ae77a78c74aee8df606ee9daba86e467108e0",
    "config.json": "bfd92c097547ab12cb42abae8008be5a59a91fdc5ab39acce24489eb8a3e8a86",
    "generation_config.json": "4617fcca458af3b91a103143aaac919c1ab6680b552d7abd10811b7248bd77b4",
    "merges.txt": "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
    "normalizer.json": "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
    "openvino_decoder_model.bin": (
        "58fbe879d2e028fc7792036ba660fde0e6c8dd85b71d596cd1a144672a807b73"
    ),
    "openvino_decoder_model.xml": (
        "926f88e8439e6850264ff14cb57f2737a0d87a8c5b7211870f985a78c69d68f4"
    ),
    "openvino_detokenizer.bin": "f2b3c47825a1089525ff65c0c8e49271e1dee69a401a04fc827ac2de5b7766e4",
    "openvino_detokenizer.xml": "cd4c080beed5a2db5b96aa7a50cf98b9e13695f99ffabeb57962893d9459fcc4",
    "openvino_encoder_model.bin": (
        "d36aff56fa2215fd93ffe4e4eb17be8a97fbad16f97f6c96126d79161b5e9b83"
    ),
    "openvino_encoder_model.xml": (
        "7bd76d5bd60795243ef4aa06b111ea58936d2df59885022b72415d6038d36e28"
    ),
    "openvino_tokenizer.bin": "adfa3d9a2920d0f314121270a960ab331ec0f05838544bb8ecaaa422282a6fd4",
    "openvino_tokenizer.xml": "79b781222585b8e45dc88791204c9b4bef84cfbce71c96ad505fc3870bd148b7",
    "preprocessor_config.json": "654cf18d3e163b948ceaf9766da56ce0b52de265d58673cf61c9376f126bd499",
    "special_tokens_map.json": "baea4ea09372eb4fca86b4e4346139fd73cb807d5087e9de0948e971739c3e74",
    "tokenizer.json": "5c1bf30c9e716e1477bedef846b01be0013daecb89e9e3ef7ab89b23c178df1b",
    "tokenizer_config.json": "3c75940dfce3a294fca7041a5faff011677f1b68fa85e47511bb8cf6dccaded6",
    "vocab.json": "6788c80b082e9b0d1393147d3a3e62ba19285ac0c82ace8e5ef00f37ead58971",
}
MODEL_NAME = "whisper-large-v3-turbo-fp16-ov"
VAD_REPO = "onnx-community/silero-vad"
VAD_REVISION = "e71cae966052b992a7eca6b17738916ce0eca4ec"
VAD_FILES = {"onnx/model.onnx": "a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808"}
VAD_SUBDIR = "silero-vad"

SR = diarize.SR
VAD_WIN, VAD_CTX = 512, 64  # 32 ms frames at 16 kHz, with 64 samples of left context
VAD_THRESHOLD = 0.5
MIN_SILENCE_SEC = 0.7
MAX_PIECE_SEC = 28.0  # under Whisper's 30 s window
MIN_SPEECH_SEC = 0.3
PAD_SEC = 0.2
MAX_NEW_TOKENS = 440
RETRY_REPETITION_PENALTY = 1.1  # only for looped pieces: on normal ones it rewrites 16 of 25
LOOP_RE = re.compile(r"(.{1,8}?)\1{4,}")  # a 1-8 character unit repeated 5+ times


class AsrUnavailable(RuntimeError):
    """The model files or openvino-genai are not installed."""


_pipe_lock = threading.Lock()
_pipe: Any = None
_device = ""
_run_lock = threading.Lock()
_running: dict[str, tuple[int, int]] = {}  # meeting id -> (pieces done, pieces total)


def model_ready(model_dir: Path | None = None) -> bool:
    root = model_dir or config.asr_model_dir()
    whisper = all((root / name).is_file() for name in MODEL_FILES)
    return whisper and all((root / VAD_SUBDIR / name).is_file() for name in VAD_FILES)


def install(target: Path, source: Path | None = None) -> list[str]:
    files = ocr.install(target, source, files=MODEL_FILES, repo=MODEL_REPO, revision=MODEL_REVISION)
    files += ocr.install(target / VAD_SUBDIR, files=VAD_FILES, repo=VAD_REPO, revision=VAD_REVISION)
    return files


# ---------- VAD ----------


def speech_probs(audio: Any, run: Callable[[dict], list] | None = None) -> Any:
    """Silero speech probability per 32 ms frame."""
    import numpy as np

    if run is None:
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise AsrUnavailable("onnxruntime is not installed") from exc
        path = config.asr_model_dir() / VAD_SUBDIR / "onnx" / "model.onnx"
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        run = lambda feed: session.run(None, feed)  # noqa: E731
    state = np.zeros((2, 1, 128), np.float32)
    context = np.zeros((1, VAD_CTX), np.float32)
    sr = np.array(SR, np.int64)
    probs = []
    for start in range(0, len(audio) - VAD_WIN + 1, VAD_WIN):
        x = np.concatenate([context, audio[None, start : start + VAD_WIN]], axis=1)
        out, state = run({"input": x.astype(np.float32), "state": state, "sr": sr})
        context = x[:, -VAD_CTX:]
        probs.append(float(out[0][0]))
    return np.array(probs, np.float32)


def speech_pieces(probs: Any, n_samples: int) -> list[tuple[int, int]]:
    """Sample spans of speech, joined across pauses shorter than MIN_SILENCE_SEC.

    No span is longer than MAX_PIECE_SEC; a stretch with no pause long enough is cut evenly.
    """
    import numpy as np

    spans: list[list[int]] = []
    for i in np.flatnonzero(probs >= VAD_THRESHOLD):
        if spans and spans[-1][1] == i:
            spans[-1][1] = i + 1
        else:
            spans.append([int(i), int(i) + 1])
    gap = int(MIN_SILENCE_SEC * SR / VAD_WIN)
    merged: list[list[int]] = []
    for a, b in spans:
        fits = (b - merged[-1][0]) * VAD_WIN <= MAX_PIECE_SEC * SR if merged else False
        if merged and a - merged[-1][1] < gap and fits:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    pad = int(PAD_SEC * SR)
    pieces: list[tuple[int, int]] = []
    for a, b in merged:
        if (b - a) * VAD_WIN < MIN_SPEECH_SEC * SR:
            continue
        s, e = max(0, a * VAD_WIN - pad), min(n_samples, b * VAD_WIN + pad)
        n = int(np.ceil((e - s) / (MAX_PIECE_SEC * SR)))
        step = (e - s) / n
        pieces += [(int(s + k * step), int(s + (k + 1) * step)) for k in range(n)]
    return pieces


# ---------- Whisper ----------


def _load_pipe() -> tuple[Any, str]:
    """WhisperPipeline on the Arc GPU, or on the CPU when the GPU cannot compile it."""
    global _pipe, _device
    with _pipe_lock:
        if _pipe is None:
            root = config.asr_model_dir()
            if not model_ready(root):
                raise AsrUnavailable(f"ASR model not installed in {root}")
            try:
                import openvino_genai as ov_genai
            except ImportError as exc:
                raise AsrUnavailable("openvino-genai is not installed") from exc
            try:
                _pipe, _device = ov_genai.WhisperPipeline(str(root), "GPU"), "GPU"
            except RuntimeError:
                _pipe, _device = ov_genai.WhisperPipeline(str(root), "CPU"), "CPU"
        return _pipe, _device


def _stamp(sec: float) -> str:
    sec = int(sec)
    h, m, s = sec // 3600, sec // 60 % 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def transcribe(
    audio: Any,
    pieces: list[tuple[int, int]],
    generate: Callable[[Any, bool], str],
    progress: Callable[[int, int], None] | None = None,
) -> list[dict]:
    """One transcript segment per speech piece that produced text.

    `generate(piece, retry)` decodes a piece; retry=True asks for the anti-loop settings.
    """
    segments: list[dict] = []
    for i, (s, e) in enumerate(pieces):
        text = generate(audio[s:e], False).strip()
        if LOOP_RE.search(text):
            text = LOOP_RE.sub(r"\1", generate(audio[s:e], True).strip())
        if text:
            start, end = round(s / SR, 2), round(e / SR, 2)
            segments.append(
                {
                    "id": f"asr-{len(segments) + 1}",
                    "start": start,
                    "end": end,
                    "timestamp": _stamp(start),
                    "text": text,
                }
            )
        if progress:
            progress(i + 1, len(pieces))
    return segments


def transcribe_video(
    video: Path, audio_track: int = 0, progress: Callable[[int, int], None] | None = None
) -> dict:
    """Run the whole pipeline on a video file; the result is what asr.json stores."""
    started = time.perf_counter()
    tracks = diarize.count_audio_tracks(video)
    if audio_track >= tracks:
        raise ValueError(f"Audio track {audio_track + 1} not found ({tracks} tracks)")
    pipe, device = _load_pipe()
    audio = diarize.load_audio(video, audio_track)
    pieces = speech_pieces(speech_probs(audio), len(audio))

    def config(repetition_penalty: float = 1.0) -> Any:
        cfg = pipe.get_generation_config()
        cfg.language = "<|th|>"
        cfg.task = "transcribe"
        cfg.return_timestamps = False
        cfg.max_new_tokens = MAX_NEW_TOKENS
        cfg.repetition_penalty = repetition_penalty
        return cfg

    first, retry = config(), config(RETRY_REPETITION_PENALTY)

    def generate(piece: Any, again: bool) -> str:
        return str(pipe.generate(piece.tolist(), retry if again else first).texts[0])

    segments = transcribe(audio, pieces, generate, progress)
    duration = len(audio) / SR
    elapsed = time.perf_counter() - started
    return {
        "status": "done",
        "model": f"{MODEL_NAME}@{MODEL_REVISION[:8]}",
        "device": device,
        "audioTrack": audio_track + 1,
        "durationSec": round(duration, 1),
        "elapsedSec": round(elapsed, 1),
        "rtf": round(elapsed / duration, 3) if duration else 0.0,
        "pieces": len(pieces),
        "segments": segments,
    }


# ---------- one run at a time (it fills the GPU) ----------


def try_start(meeting_id: str) -> bool:
    with _run_lock:
        if _running:
            return False
        _running[meeting_id] = (0, 0)
        return True


def set_progress(meeting_id: str, done: int, total: int) -> None:
    with _run_lock:
        if meeting_id in _running:
            _running[meeting_id] = (done, total)


def progress(meeting_id: str) -> tuple[int, int] | None:
    with _run_lock:
        return _running.get(meeting_id)


def finish(meeting_id: str) -> None:
    with _run_lock:
        _running.pop(meeting_id, None)


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app.asr")
    sub = ap.add_subparsers(dest="cmd", required=True)
    inst = sub.add_parser("install", help="install the pinned Whisper turbo and Silero VAD models")
    inst.add_argument("--from", dest="source", type=Path, default=None)
    sub.add_parser("status", help="show where the models are and whether they are ready")
    args = ap.parse_args()

    target = config.asr_model_dir()
    if args.cmd == "install":
        files = install(target, args.source)
        print(f"Installed {len(files)} files into {target}")
    else:
        print(f"{target} ready={model_ready(target)}")


if __name__ == "__main__":
    main()
