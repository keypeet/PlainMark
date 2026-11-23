"""Slide OCR with OpenThai2.1-OCR-Text (Apache-2.0) on CPU through ONNX Runtime.

The model and its runtime package live outside the repo, in config.ocr_model_dir().
Install them (files pinned to v2.1.4, checked against SHA-256) with:

    uv run --directory backend python -m app.ocr install            # download from Hugging Face
    uv run --directory backend python -m app.ocr install --from DIR # copy a downloaded folder
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import shutil
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path
from typing import Any

from . import config

MODEL_REPO = "iapp/OpenThai2.1-OCR-Text-20261118"
MODEL_REVISION = "v2.1.4"
MODEL_FILES = {
    "config.json": "f5a38f5677784b10d4abcc2ad8a8b044826a8211bc51213b38c889ad792b417a",
    "det.onnx": "193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8",
    "det.yml": "3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593",
    "rec.onnx": "82ec89533346faadcb30df96703dad2dd7521de65709e60d83fd9745b8968124",
    "rec2.onnx": "6ec0f96f5ade665fc7eb33a9800ed055bc220870cbf963cf97c4750e64cd27ce",
    "rec_dict.txt": "259ef2636cec0eeae225ae9fd9a63fa9305285650c22d7ec34fe8a82b24c2f1a",
    "NOTICE": "4c0e4f27877836de51e29aec3918b6c743c3028cd4163b6661fd540336db32b3",
    "runtime/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "runtime/line_engine.py": "6bbd83c590e66445a6844f69ed3029be98e3be0fd1fcc01e2147ace28748d54a",
    "runtime/thai_norm.py": "53a03ac139fb0de3e7aec0f5b8ab69b0b519fb5e636f7c1de09cb357b023344a",
}
# Screen text is small (~17 px on a 1920 frame); reading at 1.5x restores Thai lower vowels
# and "%" at the same speed (spike 2026-11-23).
UPSCALE = 1.5
RUNTIME_PACKAGE = "openthai_ocr_runtime"


class OcrUnavailable(RuntimeError):
    """The model files or the OCR dependencies (opencv, pyclipper) are not installed."""


_lock = threading.Lock()
_engine: Any = None


def model_ready(model_dir: Path | None = None) -> bool:
    root = model_dir or config.ocr_model_dir()
    return all((root / name).is_file() for name in MODEL_FILES)


def _load_engine(model_dir: Path) -> Any:
    if not model_ready(model_dir):
        raise OcrUnavailable(f"OCR model not installed in {model_dir}")
    try:
        import cv2  # noqa: F401
        import pyclipper  # noqa: F401
    except ImportError as exc:
        missing = "OCR dependencies missing (opencv-python-headless, pyclipper)"
        raise OcrUnavailable(missing) from exc
    # The runtime uses a relative import, so load it as a package under a unique name.
    if RUNTIME_PACKAGE not in sys.modules:
        init = model_dir / "runtime" / "__init__.py"
        spec = importlib.util.spec_from_file_location(
            RUNTIME_PACKAGE, init, submodule_search_locations=[str(init.parent)]
        )
        if spec is None or spec.loader is None:
            raise OcrUnavailable("OCR runtime package cannot be loaded")
        package = importlib.util.module_from_spec(spec)
        sys.modules[RUNTIME_PACKAGE] = package
        spec.loader.exec_module(package)
    line_engine = importlib.import_module(f"{RUNTIME_PACKAGE}.line_engine")
    return line_engine.LineOCR(str(model_dir), threads=2)


def read_png(data: bytes) -> str:
    """Return the text of an image in reading order, one line per row."""
    global _engine
    with _lock:
        if _engine is None:
            _engine = _load_engine(config.ocr_model_dir())
        import cv2
        import numpy as np

        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Cannot decode image")
        img = cv2.resize(img, None, fx=UPSCALE, fy=UPSCALE, interpolation=cv2.INTER_CUBIC)
        return str(_engine.read(img)["text"]).strip()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install(target: Path, source: Path | None = None) -> list[str]:
    """Copy or download every pinned file into target; refuse any file whose hash differs."""
    target.mkdir(parents=True, exist_ok=True)
    installed: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, expected in MODEL_FILES.items():
            staged = Path(tmp) / name
            staged.parent.mkdir(parents=True, exist_ok=True)
            if source is not None:
                shutil.copyfile(source / name, staged)
            else:
                url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{name}"
                with urllib.request.urlopen(url, timeout=120) as resp, staged.open("wb") as out:
                    shutil.copyfileobj(resp, out)
            actual = _sha256(staged)
            if actual != expected:
                raise ValueError(f"Checksum mismatch for {name}: {actual}")
        for name in MODEL_FILES:
            dest = target / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(Path(tmp) / name), dest)
            installed.append(name)
    return installed


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app.ocr")
    sub = ap.add_subparsers(dest="cmd", required=True)
    inst = sub.add_parser("install", help="install the pinned OpenThai OCR model")
    inst.add_argument("--from", dest="source", type=Path, default=None)
    sub.add_parser("status", help="show where the model is and whether it is ready")
    args = ap.parse_args()

    target = config.ocr_model_dir()
    if args.cmd == "install":
        files = install(target, args.source)
        print(f"Installed {len(files)} files into {target}")
    else:
        print(f"{target} ready={model_ready(target)}")


if __name__ == "__main__":
    main()
