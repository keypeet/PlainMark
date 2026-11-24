"""Voiceprints: one WeSpeaker embedding per diarized speaker, matched against saved voiceprints.

Model: Wespeaker/wespeaker-voxceleb-resnet34-LM (CC-BY-4.0, trained on VoxCeleb), 256-dim
embeddings from 80-dim Kaldi fbank. It lives outside the repo, in config.voiceprint_model_dir().
Install it with:

    uv run --directory backend python -m app.voiceprint install             # from Hugging Face
    uv run --directory backend python -m app.voiceprint install --from DIR  # from a folder

Only embeddings are kept (never audio). Spike on a real Thai meeting: the same person scored
0.84-0.99 cosine between two halves of the meeting, different people at most 0.37.
"""

from __future__ import annotations

import argparse
import threading
from pathlib import Path
from typing import Any

from . import config, ocr

MODEL_REPO = "Wespeaker/wespeaker-voxceleb-resnet34-LM"
MODEL_REVISION = "f0c48c298fd835726c27956a5d617bad7115627e"
MODEL_FILES = {
    "voxceleb_resnet34_LM.onnx": "7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068",
}

SR = 16000
WIN_SEC, MAX_WIN_SEC = 1.0, 3.0  # embed solo speech in windows of 1-3 s
MAX_WINDOWS = 40  # per speaker, longest turns first
MATCH_SCORE = 0.6  # at or above: the saved voiceprint's name is applied
SUGGEST_SCORE = 0.45  # between this and MATCH_SCORE: offered for the user to confirm

_session_lock = threading.Lock()
_session: Any = None


def model_ready(model_dir: Path | None = None) -> bool:
    root = model_dir or config.voiceprint_model_dir()
    return all((root / name).is_file() for name in MODEL_FILES)


def install(target: Path, source: Path | None = None) -> list[str]:
    return ocr.install(target, source, files=MODEL_FILES, repo=MODEL_REPO, revision=MODEL_REVISION)


# ---------- Kaldi-style 80-dim fbank, what WeSpeaker was trained on ----------


def _mel_filters(
    n_fft: int = 512, n_mels: int = 80, fmin: float = 20.0, fmax: float = 8000.0
) -> Any:
    import numpy as np

    def mel(f):
        return 1127.0 * np.log(1.0 + f / 700.0)

    centers = np.linspace(mel(fmin), mel(fmax), n_mels + 2)
    fft_mel = mel(np.arange(n_fft // 2) * SR / n_fft)
    w = np.zeros((n_mels, n_fft // 2 + 1), np.float32)
    for m in range(n_mels):
        left, c, right = centers[m], centers[m + 1], centers[m + 2]
        w[m, : n_fft // 2] = np.maximum(
            0, np.minimum((fft_mel - left) / (c - left), (right - fft_mel) / (right - c))
        )
    return w


def fbank(audio: Any) -> Any:
    """[frames, 80] log-mel, 25 ms Povey window every 10 ms, mean-normalised (CMN)."""
    import numpy as np

    x = audio.astype(np.float64) * 32768.0
    n = 1 + (len(x) - 400) // 160
    frames = x[np.arange(400)[None, :] + 160 * np.arange(n)[:, None]]
    frames -= frames.mean(axis=1, keepdims=True)
    frames = np.concatenate([frames[:, :1] * 0.03, frames[:, 1:] - 0.97 * frames[:, :-1]], axis=1)
    frames *= (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(400) / 399)) ** 0.85
    spec = np.abs(np.fft.rfft(frames, 512, axis=1)) ** 2
    feats = np.log(np.maximum(spec @ _mel_filters().T, np.finfo(np.float32).eps)).astype(np.float32)
    return feats - feats.mean(axis=0, keepdims=True)


def _load_session() -> Any:
    global _session
    with _session_lock:
        if _session is None:
            import onnxruntime as ort

            path = config.voiceprint_model_dir() / "voxceleb_resnet34_LM.onnx"
            _session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        return _session


def _unit(v: Any) -> Any:
    import numpy as np

    return v / max(float(np.linalg.norm(v)), 1e-9)


def speaker_embeddings(
    audio: Any, turns: list[dict], speaker_ids: list[str]
) -> dict[str, list[float]]:
    """Mean unit embedding per speaker, from stretches where only that speaker talks."""
    import numpy as np

    session = _load_session()
    spans = sorted(((t["start"], t["end"], t["speakerId"]) for t in turns), key=lambda s: s[0])
    out: dict[str, list[float]] = {}
    for spk in speaker_ids:
        solo: list[tuple[float, float]] = []
        for a, b, who in spans:
            if who != spk:
                continue
            for c, d, other in spans:  # trim the parts that overlap another speaker
                if other != spk and c < b and d > a:
                    if c <= a:
                        a = max(a, d)
                    else:
                        b = min(b, c)
            if b - a >= WIN_SEC:
                solo.append((a, b))
        solo.sort(key=lambda s: s[0] - s[1])  # longest first
        windows = [(a, min(b, a + MAX_WIN_SEC)) for a, b in solo[:MAX_WINDOWS]]
        vecs = []
        for a, b in windows:
            piece = audio[int(a * SR) : int(b * SR)]
            if len(piece) < WIN_SEC * SR:
                continue
            emb = session.run(None, {"feats": fbank(piece)[None]})[0][0]
            vecs.append(_unit(emb))
        if vecs:
            out[spk] = [round(float(x), 6) for x in _unit(np.mean(vecs, axis=0))]
    return out


def cosine(a: list[float], b: list[float]) -> float:
    import numpy as np

    va, vb = np.asarray(a, np.float64), np.asarray(b, np.float64)
    if va.shape != vb.shape or not va.size:
        return 0.0
    return float(_unit(va) @ _unit(vb))


def match_speakers(speakers: list[dict], voiceprints: list[dict]) -> None:
    """Give each speaker the closest saved voiceprint: applied when sure, suggested when close."""
    taken: set[str] = set()
    pairs = sorted(
        (
            (cosine(s["embedding"], vp.get("embedding") or []), s["id"], vp)
            for s in speakers
            if s.get("embedding")
            for vp in voiceprints
            if vp.get("embedding")
        ),
        key=lambda p: -p[0],
    )
    done: set[str] = set()
    by_id = {s["id"]: s for s in speakers}
    for score, sid, vp in pairs:  # greedy one-to-one, best scores first
        if sid in done or vp["id"] in taken or score < SUGGEST_SCORE:
            continue
        s = by_id[sid]
        s["matchScore"] = round(score, 3)
        if score >= MATCH_SCORE:
            s["voiceprintId"], s["name"] = vp["id"], vp.get("name") or ""
        else:
            s["suggestedVoiceprintId"], s["suggestedName"] = vp["id"], vp.get("name") or ""
        done.add(sid)
        taken.add(vp["id"])


def merge_embedding(old: list[float], samples: int, new: list[float]) -> list[float]:
    """Running mean of unit embeddings: each meeting the person is named in sharpens it."""
    import numpy as np

    if not old or samples <= 0 or len(old) != len(new):
        return list(new)
    mean = (np.asarray(old) * samples + np.asarray(new)) / (samples + 1)
    return [round(float(x), 6) for x in _unit(mean)]


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app.voiceprint")
    sub = ap.add_subparsers(dest="cmd", required=True)
    inst = sub.add_parser("install", help="install the pinned WeSpeaker ResNet34 model")
    inst.add_argument("--from", dest="source", type=Path, default=None)
    sub.add_parser("status", help="show where the model is and whether it is ready")
    args = ap.parse_args()

    target = config.voiceprint_model_dir()
    if args.cmd == "install":
        files = install(target, args.source)
        print(f"Installed {len(files)} files into {target}")
    else:
        print(f"{target} ready={model_ready(target)}")


if __name__ == "__main__":
    main()
