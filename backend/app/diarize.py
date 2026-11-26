"""Who spoke when in a meeting recording, with NVIDIA Nemotron 3 Diarization on CPU (ONNX Runtime).

End-to-end model: it finds up to 8 speakers itself (no clustering, no threshold to tune).
The ONNX graph scores one ~27 s chunk given the cached frames; the chunk loop and the
Arrival-Order Speaker Cache + FIFO below are ported from the offline path of transformers'
`Nemotron3DiarizationForAudioFrameClassification`.
Spike (38 min meeting, 4 speakers): 4 found, ~108 s on CPU, the user's mic track matched 97%.

Run it with ONNX Runtime only: OpenVINO (CPU and GPU) returns wrong logits for this int8 export.

The model (OpenMDW 1.1) lives outside the repo, in config.diarize_model_dir(). Install it with:

    uv run --directory backend python -m app.diarize install            # download from Hugging Face
    uv run --directory backend python -m app.diarize install --from DIR # copy a downloaded folder

Audio comes from the video through ffmpeg. OBS records the mix on audio track 1 and the
user's own mic on track 2; when the mic track exists, the speaker it matches is marked `isMe`.
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import config, ocr, voiceprint

MODEL_REPO = "onnx-community/Nemotron-3-Diarization-ONNX"
MODEL_REVISION = "353b6f8ad2cac3580e982d7fbdf0a010786b0406"
MODEL_FILES = {
    "onnx/model_quantized.onnx": "fff7d18c7439c9fdc1c6c4dfec924cb42d3344264ca879780dfaf7ee886e6c1e",
    "onnx/model_quantized.onnx_data": (
        "002d7483e1c865c35c82220fdb378f185ff213c6d35922b38ae421c8ec72c338"
    ),
}
MODEL_NAME = "nemotron-3-diarization-int8"

SR = 16000
HOP = 160  # samples per 10 ms output frame
SUB = 8  # mel frames per encoder frame
N_SPK = 8
# offline schedule (config.json top level) and speaker-cache policy (config.json streaming_config)
CHUNK_LEN, RIGHT_CTX = 340, 40
FIFO_LEN, UPDATE_PERIOD = 40, 300
CACHE_LEN, SIL_FRAMES = 264, 1
SCORE_THRESHOLD, LATEST_BOOST = 0.25, 0.05
_BUDGET = CACHE_LEN // N_SPK - SIL_FRAMES
MIN_POSITIVE = math.floor(_BUDGET * 0.5)
N_STRONG = math.floor(_BUDGET * 0.75)
N_WEAK = math.floor(_BUDGET * 1.5)

SPEECH_THRESHOLD = 0.5
MIN_GAP_SEC, MIN_TURN_SEC = 0.3, 0.2
MIN_SPEAKER_SEC = 3.0  # a speaker slot with less talk is model noise (1.2 s on a real meeting)
MIC_ACTIVE_DB = -45.0  # a 100 ms frame of the mic track louder than this counts as the user talking
MIC_MIN_SEC = 5.0


class DiarizeUnavailable(RuntimeError):
    """The model files, onnxruntime or ffmpeg are not installed."""


_session_lock = threading.Lock()
_session: Any = None
_run_lock = threading.Lock()
_running: set[str] = set()


def model_ready(model_dir: Path | None = None) -> bool:
    root = model_dir or config.diarize_model_dir()
    return all((root / name).is_file() for name in MODEL_FILES)


def install(target: Path, source: Path | None = None) -> list[str]:
    return ocr.install(target, source, files=MODEL_FILES, repo=MODEL_REPO, revision=MODEL_REVISION)


# ---------- audio ----------


def _tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise DiarizeUnavailable(f"{name} not found on PATH")
    return path


def count_audio_tracks(video: Path) -> int:
    out = subprocess.run(
        [
            _tool("ffprobe"),
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(video),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return len([line for line in out.splitlines() if line.strip()])


def load_audio(video: Path, track: int) -> Any:
    """Audio track `track` (0-based) as 16 kHz mono float32."""
    import numpy as np

    raw = subprocess.run(
        [
            _tool("ffmpeg"),
            "-v",
            "error",
            "-i",
            str(video),
            "-map",
            f"0:a:{track}",
            "-ac",
            "1",
            "-ar",
            str(SR),
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


# ---------- features: 128 log-mel, as NemotronAsrStreamingFeatureExtractor (not normalised) ----


def _mel_filters(n_fft: int = 512, n_mels: int = 128, fmax: float = 8000.0) -> Any:
    """librosa.filters.mel(sr=16000, n_fft, n_mels, fmin=0, fmax, htk=False, norm='slaney')."""
    import numpy as np

    def hz_to_mel(f):
        f = np.asanyarray(f, dtype=np.float64)
        log = 15.0 + np.log(np.maximum(f, 1e-10) / 1000.0) / (np.log(6.4) / 27.0)
        return np.where(f >= 1000.0, log, f / (200.0 / 3))

    def mel_to_hz(m):
        m = np.asanyarray(m, dtype=np.float64)
        log = 1000.0 * np.exp((np.log(6.4) / 27.0) * (m - 15.0))
        return np.where(m >= 15.0, log, (200.0 / 3) * m)

    fft_freqs = np.linspace(0, SR / 2, n_fft // 2 + 1)
    mel_pts = mel_to_hz(np.linspace(hz_to_mel(0.0), hz_to_mel(fmax), n_mels + 2))
    fdiff = np.diff(mel_pts)
    ramps = mel_pts[:, None] - fft_freqs[None, :]
    weights = np.zeros((n_mels, len(fft_freqs)))
    for i in range(n_mels):
        weights[i] = np.maximum(0, np.minimum(-ramps[i] / fdiff[i], ramps[i + 2] / fdiff[i + 1]))
    weights *= (2.0 / (mel_pts[2 : n_mels + 2] - mel_pts[:n_mels]))[:, None]
    return weights.astype(np.float32)


def log_mel(audio: Any) -> Any:
    """[frames, 128], one frame per 10 ms, as a `center=True` pass over the whole recording."""
    import numpy as np

    n_fft, win = 512, 400
    x = np.concatenate([audio[:1], audio[1:] - 0.97 * audio[:-1]]).astype(np.float32)
    x = np.pad(x, n_fft // 2)
    window = np.hanning(win).astype(np.float32)  # symmetric, like torch.hann_window(periodic=False)
    window = np.pad(window, ((n_fft - win) // 2, n_fft - win - (n_fft - win) // 2))
    mel = _mel_filters()
    n = len(audio) // HOP
    out = np.empty((n, 128), np.float32)
    for start in range(0, n, 20000):  # in blocks so an hour of audio stays small in memory
        idx = np.arange(n_fft)[None, :] + HOP * np.arange(start, min(start + 20000, n))[:, None]
        spec = np.abs(np.fft.rfft(x[idx] * window, axis=1)) ** 2
        out[start : start + len(idx)] = np.log(spec @ mel.T + 2.0**-24)
    return out


# ---------- streaming state ----------


class SpeakerCache:
    """Arrival-Order Speaker Cache + FIFO queue of the most recent encoder frames (batch size 1)."""

    def __init__(self) -> None:
        import numpy as np

        self.embeds = np.zeros((0, 512), np.float32)
        self.probs = np.zeros((0, N_SPK), np.float32)
        self.fifo = np.zeros((0, 512), np.float32)
        self.compressed = False

    def get(self) -> Any:
        import numpy as np

        return np.concatenate([self.embeds, self.fifo])

    def update(self, chunk_embeds: Any, logits: Any, sil: Any, n_chunk: int) -> None:
        import numpy as np

        nc, nf = len(self.embeds), len(self.fifo)
        sig = 1.0 / (1.0 + np.exp(-logits))
        probs = sig[: len(sig) // SUB * SUB].reshape(-1, SUB, N_SPK).mean(1)  # 80 ms frames
        fifo_embeds = np.concatenate([self.fifo, chunk_embeds[:n_chunk]])
        n = len(fifo_embeds)
        popped = 0 if n <= FIFO_LEN else min(max(UPDATE_PERIOD, n - FIFO_LEN), n)
        if popped:
            fifo_probs = np.concatenate([probs[nc : nc + nf], probs[nc + nf : nc + nf + n_chunk]])
            stored = self.probs if self.compressed else probs[:nc]
            cache_e = np.concatenate([self.embeds, fifo_embeds[:popped]])
            cache_p = np.concatenate([stored, fifo_probs[:popped]])
            fifo_embeds = fifo_embeds[popped:]
            if len(cache_e) > CACHE_LEN:
                cache_e, cache_p = self._compress(cache_e, cache_p, sil)
                self.compressed = True
            self.embeds, self.probs = cache_e.astype(np.float32), cache_p.astype(np.float32)
        self.fifo = fifo_embeds

    @staticmethod
    def _scores(p: Any) -> Any:
        import numpy as np

        lp = np.log(np.maximum(p, SCORE_THRESHOLD))
        lc = np.log(np.maximum(1.0 - p, SCORE_THRESHOLD))
        s = lp - lc + lc.sum(-1, keepdims=True) - math.log(0.5)
        speech = p > 0.5
        s = np.where(speech, s, -np.inf)
        pos = s > 0
        enough = pos.sum(0, keepdims=True) >= MIN_POSITIVE
        return np.where(~pos & speech & enough, -np.inf, s)

    @staticmethod
    def _boost(s: Any, k: int, b: float) -> Any:
        import numpy as np

        s = s.copy()
        for j in range(s.shape[1]):
            top = np.argpartition(-s[:, j], k - 1)[:k] if k < len(s) else np.arange(len(s))
            s[top, j] += b
        return s

    def _compress(self, embeds: Any, probs: Any, sil: Any) -> tuple[Any, Any]:
        """Keep the CACHE_LEN most telling frames, grouped by speaker, in their original order."""
        import numpy as np

        n = len(probs)
        s = self._scores(probs)
        s[CACHE_LEN:] += LATEST_BOOST
        s = self._boost(s, N_STRONG, -2.0 * math.log(0.5))
        s = self._boost(s, N_WEAK, -math.log(0.5))
        s = np.concatenate([s, np.full((SIL_FRAMES, N_SPK), np.inf)])
        embeds = np.concatenate([embeds, sil[None]])
        probs = np.concatenate([probs, np.zeros((1, N_SPK), probs.dtype)])
        m = n + SIL_FRAMES
        flat = s.T.reshape(-1)  # speaker-major
        sentinel = m * N_SPK
        top = np.argpartition(-flat, CACHE_LEN - 1)[:CACHE_LEN]
        top = np.sort(np.where(flat[top] == -np.inf, sentinel, top))
        frames = np.where(top == sentinel, n, np.minimum(top % m, n))
        return embeds[frames], probs[frames]


# ---------- model ----------


def _load_session() -> Any:
    global _session
    with _session_lock:
        if _session is None:
            root = config.diarize_model_dir()
            if not model_ready(root):
                raise DiarizeUnavailable(f"Diarization model not installed in {root}")
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise DiarizeUnavailable("onnxruntime is not installed") from exc
            path = root / "onnx" / "model_quantized.onnx"
            _session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        return _session


def speaker_probs(audio: Any, run: Callable[[dict], list] | None = None) -> Any:
    """Per-10 ms speaker activity probabilities [frames, 8], speakers in order of first arrival."""
    import numpy as np

    if run is None:
        session = _load_session()
        run = lambda feed: session.run(None, feed)  # noqa: E731
    feats = log_mel(audio)
    total = len(feats)
    n_embeds = math.ceil(total / SUB)
    cache = SpeakerCache()
    out = []
    for start in range(0, n_embeds, CHUNK_LEN):
        end = min(start + CHUNK_LEN, n_embeds)
        mel = feats[start * SUB : min(end + RIGHT_CTX, n_embeds) * SUB]
        cached = cache.get()
        logits, chunk_embeds, sil = run(
            {
                "input_features": np.ascontiguousarray(mel[None]),
                "cached_embeds": np.ascontiguousarray(cached[None], dtype=np.float32),
                "attention_mask": np.ones((1, len(cached) + math.ceil(len(mel) / SUB)), np.int64),
            }
        )
        logits = logits[0]
        cache.update(chunk_embeds[0], logits, sil, end - start)
        first = len(cached) * SUB
        out.append(logits[first : first + (end - start) * SUB])
    if not out:
        return np.zeros((0, N_SPK), np.float32)
    logits = np.concatenate(out)[:total]
    return 1.0 / (1.0 + np.exp(-logits))


def to_turns(probs: Any) -> list[tuple[int, float, float]]:
    """(speaker slot, start s, end s) for each stretch above SPEECH_THRESHOLD; overlaps allowed."""
    import numpy as np

    rows: list[tuple[int, float, float]] = []
    for spk in range(probs.shape[1]):
        on = np.flatnonzero(probs[:, spk] > SPEECH_THRESHOLD)
        if not len(on):
            continue
        runs = np.split(on, np.flatnonzero(np.diff(on) > 1) + 1)
        spans = [[r[0] * HOP / SR, (r[-1] + 1) * HOP / SR] for r in runs]
        merged = [spans[0]]
        for a, b in spans[1:]:
            if a - merged[-1][1] < MIN_GAP_SEC:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        rows += [(spk, a, b) for a, b in merged if b - a >= MIN_TURN_SEC]
    return sorted(rows, key=lambda r: r[1])


def mic_active(mic: Any, frame_sec: float = 0.1) -> Any:
    """Boolean per `frame_sec` frame: the user's own mic carries speech."""
    import numpy as np

    n = int(frame_sec * SR)
    frames = mic[: len(mic) // n * n].reshape(-1, n)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    return 20 * np.log10(rms + 1e-9) > MIC_ACTIVE_DB


def find_me(turns: list[dict], active: Any, frame_sec: float = 0.1) -> str | None:
    """The speaker whose turns line up with the mic track, when they clearly do."""
    total = float(active.sum()) * frame_sec
    if total < MIC_MIN_SEC:
        return None
    overlap: dict[str, float] = {}
    talk: dict[str, float] = {}
    for t in turns:
        a, b = int(t["start"] / frame_sec), int(t["end"] / frame_sec)
        overlap[t["speakerId"]] = (
            overlap.get(t["speakerId"], 0.0) + float(active[a:b].sum()) * frame_sec
        )
        talk[t["speakerId"]] = talk.get(t["speakerId"], 0.0) + t["end"] - t["start"]
    if not overlap:
        return None
    best = max(overlap, key=overlap.get)
    if overlap[best] / total >= 0.5 and overlap[best] / max(talk[best], 1e-9) >= 0.5:
        return best
    return None


def summarize(
    turns_raw: list[tuple[int, float, float]], duration: float
) -> tuple[list[dict], list[dict]]:
    """Speakers renamed spk1..spkN by talk time, and their turns; near-silent slots are dropped."""
    talk: dict[int, float] = {}
    for s, a, b in turns_raw:
        talk[s] = talk.get(s, 0.0) + b - a
    order = sorted((s for s in talk if talk[s] >= MIN_SPEAKER_SEC), key=lambda s: -talk[s])
    turns_raw = [t for t in turns_raw if t[0] in order]
    talk = {s: talk[s] for s in order}
    ids = {slot: f"spk{i + 1}" for i, slot in enumerate(order)}
    total = sum(talk.values()) or 1.0
    speakers = [
        {
            "id": ids[s],
            "talkSec": round(talk[s], 1),
            "share": round(talk[s] / total, 4),
            "isMe": False,
        }
        for s in order
    ]
    turns = [
        {"speakerId": ids[s], "start": round(a, 2), "end": round(min(b, duration), 2)}
        for s, a, b in turns_raw
    ]
    return speakers, turns


def diarize_video(video: Path, audio_track: int = 0, mic_track: int | None = None) -> dict:
    """Run the whole pipeline on a video file; the result is what diarization.json stores."""
    started = time.perf_counter()
    tracks = count_audio_tracks(video)
    if audio_track >= tracks:
        raise ValueError(f"Audio track {audio_track + 1} not found ({tracks} tracks)")
    if mic_track is None and tracks >= 2:
        mic_track = 1
    audio = load_audio(video, audio_track)
    duration = len(audio) / SR
    speakers, turns = summarize(to_turns(speaker_probs(audio)), duration)
    me = None
    if mic_track is not None and mic_track < tracks and mic_track != audio_track:
        me = find_me(turns, mic_active(load_audio(video, mic_track)))
    for s in speakers:
        s["isMe"] = s["id"] == me
    voiceprints = "unavailable"
    if voiceprint.model_ready():
        embeddings = voiceprint.speaker_embeddings(audio, turns, [s["id"] for s in speakers])
        for s in speakers:
            if s["id"] in embeddings:
                s["embedding"] = embeddings[s["id"]]
        voiceprints = "done"
    return {
        "status": "done",
        "model": f"{MODEL_NAME}@{MODEL_REVISION[:8]}",
        "audioTrack": audio_track + 1,
        "micTrack": (mic_track + 1) if mic_track is not None and mic_track < tracks else None,
        "durationSec": round(duration, 1),
        "elapsedSec": round(time.perf_counter() - started, 1),
        "voiceprints": voiceprints,
        "speakers": speakers,
        "turns": turns,
    }


def assign_speakers(segments: list[dict], turns: list[dict]) -> list[dict]:
    """Give each timed transcript segment the speaker who talks most during it.

    Old labels on timed segments are dropped (no overlapping turn: no speaker);
    untimed segments are left as they are.
    """
    out = []
    for seg in segments:
        a, b = seg.get("start"), seg.get("end")
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            out.append(seg)
            continue
        talk: dict[str, float] = {}
        for t in turns:
            overlap = min(b, t["end"]) - max(a, t["start"])
            if overlap > 0:
                talk[t["speakerId"]] = talk.get(t["speakerId"], 0.0) + overlap
        s = {k: v for k, v in seg.items() if k not in ("speakerId", "speakerName", "speaker")}
        if talk:
            s["speakerId"] = max(talk, key=talk.get)
        out.append(s)
    return out


def speaker_labels(speakers: list[dict]) -> dict[str, str]:
    """Display name per speaker id, as the Speakers tab shows it."""
    return {sp["id"]: sp.get("name") or f"ผู้พูด {i + 1}" for i, sp in enumerate(speakers)}


def try_start(meeting_id: str) -> bool:
    """Reserve the single diarization slot (a run uses every CPU core); False if one is running."""
    with _run_lock:
        if _running:
            return False
        _running.add(meeting_id)
        return True


def finish(meeting_id: str) -> None:
    with _run_lock:
        _running.discard(meeting_id)


def is_running(meeting_id: str) -> bool:
    with _run_lock:
        return meeting_id in _running


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app.diarize")
    sub = ap.add_subparsers(dest="cmd", required=True)
    inst = sub.add_parser("install", help="install the pinned Nemotron 3 Diarization model")
    inst.add_argument("--from", dest="source", type=Path, default=None)
    sub.add_parser("status", help="show where the model is and whether it is ready")
    args = ap.parse_args()

    target = config.diarize_model_dir()
    if args.cmd == "install":
        files = install(target, args.source)
        print(f"Installed {len(files)} files into {target}")
    else:
        print(f"{target} ready={model_ready(target)}")


if __name__ == "__main__":
    main()
