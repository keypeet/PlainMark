"""Runtime paths and configuration for PlainMark v2."""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_PORT = 4985


def default_data_root() -> Path:
    """Default workspace data folder outside OneDrive (C:\\Users\\<user>\\PlainMarkData)."""
    env_dir = os.environ.get("PLAINMARK_DATA_DIR", "").strip()
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    return (Path.home() / "PlainMarkData").resolve()


def _model_dir(env_var: str, name: str) -> Path:
    env_dir = os.environ.get(env_var, "").strip()
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    base = os.environ.get("LOCALAPPDATA", "").strip()
    root = Path(base) / "PlainMark" if base else Path.home() / ".plainmark"
    return (root / "models" / name).resolve()


def ocr_model_dir() -> Path:
    """OpenThai OCR model + runtime, kept outside the repo (installed by `python -m app.ocr`)."""
    return _model_dir("PLAINMARK_OCR_MODEL_DIR", "openthai-ocr-text")


def diarize_model_dir() -> Path:
    """Nemotron 3 Diarization ONNX, kept outside the repo (installed by `python -m app.diarize`)."""
    return _model_dir("PLAINMARK_DIARIZE_MODEL_DIR", "nemotron3-diarization")


def voiceprint_model_dir() -> Path:
    """WeSpeaker embedding ONNX, kept outside the repo (installed by `python -m app.voiceprint`)."""
    return _model_dir("PLAINMARK_VOICEPRINT_MODEL_DIR", "wespeaker-resnet34")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def dist_dir() -> Path:
    return repo_root() / "dist"


def server_port() -> int:
    raw = os.environ.get("PLAINMARK_PORT", str(DEFAULT_PORT)).strip()
    try:
        port = int(raw)
        if 1024 <= port <= 65535:
            return port
    except ValueError:
        pass
    return DEFAULT_PORT
