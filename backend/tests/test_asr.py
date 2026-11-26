"""Speech to text: VAD pieces, segments, and the meeting transcription API."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from app import asr
from app.main import create_app

FRAME_SEC = asr.VAD_WIN / asr.SR  # 32 ms


def probs_with(ranges: list[tuple[float, float]], seconds: float) -> np.ndarray:
    p = np.zeros(int(seconds / FRAME_SEC), np.float32)
    for a, b in ranges:
        p[int(a / FRAME_SEC) : int(b / FRAME_SEC)] = 0.9
    return p


def test_pieces_join_short_pauses_split_long_ones_and_drop_blips() -> None:
    seconds = 60.0
    probs = probs_with([(1, 4), (4.3, 6), (10, 12), (20, 20.1)], seconds)
    spans = asr.speech_pieces(probs, int(seconds * asr.SR))
    pieces = [(round(s / asr.SR, 1), round(e / asr.SR, 1)) for s, e in spans]
    assert len(pieces) == 2  # 0.3 s pause joined, 4 s pause kept, 0.1 s blip dropped
    assert pieces[0][0] < 1.0 and 5.9 < pieces[0][1] < 6.5
    assert 9.5 < pieces[1][0] < 10.0


def test_speech_with_no_pause_is_cut_under_whisper_window() -> None:
    seconds = 70.0
    pieces = asr.speech_pieces(probs_with([(0, 70)], seconds), int(seconds * asr.SR))
    assert len(pieces) == 3
    assert all((e - s) / asr.SR <= asr.MAX_PIECE_SEC for s, e in pieces)
    assert pieces[0][0] == 0 and pieces[-1][1] == int(seconds * asr.SR)


def test_vad_feeds_frames_with_context_and_carries_state() -> None:
    feeds: list[dict] = []

    def fake_run(feed: dict) -> list:
        feeds.append(feed)
        return [np.array([[0.8]], np.float32), feed["state"] + 1]

    probs = asr.speech_probs(np.zeros(asr.VAD_WIN * 3 + 10, np.float32), fake_run)
    assert probs.tolist() == [np.float32(0.8)] * 3
    assert feeds[0]["input"].shape == (1, asr.VAD_CTX + asr.VAD_WIN)
    assert feeds[2]["state"][0, 0, 0] == 2  # state from the previous frame


def test_transcribe_keeps_pieces_with_text_and_reports_progress() -> None:
    audio = np.zeros(asr.SR * 80, np.float32)
    texts = iter(["  สวัสดีครับ ", "", "เปิด JSON"])
    seen: list[tuple[int, int]] = []
    segments = asr.transcribe(
        audio,
        [(0, asr.SR * 2), (asr.SR * 5, asr.SR * 6), (asr.SR * 65, asr.SR * 70)],
        lambda _piece, _retry: next(texts),
        lambda d, n: seen.append((d, n)),
    )
    assert segments == [
        {"id": "asr-1", "start": 0.0, "end": 2.0, "timestamp": "00:00", "text": "สวัสดีครับ"},
        {"id": "asr-2", "start": 65.0, "end": 70.0, "timestamp": "01:05", "text": "เปิด JSON"},
    ]
    assert seen == [(1, 3), (2, 3), (3, 3)]


def test_a_looped_piece_is_decoded_again_and_leftover_repeats_are_collapsed() -> None:
    audio = np.zeros(asr.SR * 10, np.float32)
    calls: list[bool] = []

    def generate(_piece, retry: bool) -> str:
        calls.append(retry)
        if not retry:
            return "เริ่ม" + "การ" * 30
        return "แผน overview ก่อน" if len(calls) == 2 else "ครับ" + "ออก" * 9

    pieces = [(0, asr.SR * 2), (asr.SR * 3, asr.SR * 5)]
    texts = [s["text"] for s in asr.transcribe(audio, pieces, generate)]
    assert texts == ["แผน overview ก่อน", "ครับออก"]
    assert calls == [False, True, False, True]
    assert asr.transcribe(audio, pieces[:1], lambda _p, _r: "ครับ ครับ")[0]["text"] == "ครับ ครับ"


def setup(tmp_path: Path) -> tuple[TestClient, str, Path]:
    client = TestClient(create_app(data_root=tmp_path / "PlainMarkData"))
    media = tmp_path / "Videos"
    media.mkdir()
    client.put("/api/settings", json={"meetingsWatch": {"watchPath": str(media)}})
    mid = client.post("/api/meetings", json={"title": "Weekly", "scope": "general"}).json()["id"]
    video = media / "rec.mp4"
    video.write_bytes(b"x")
    return client, mid, video


def wait_done(client: TestClient, mid: str) -> dict:
    for _ in range(100):
        state = client.get(f"/api/meetings/{mid}/asr").json()
        if state["status"] != "running":
            return state
        time.sleep(0.02)
    raise AssertionError("transcription did not finish")


def test_api_transcribes_in_background_and_replaces_the_transcript(
    tmp_path: Path, monkeypatch
) -> None:
    client, mid, video = setup(tmp_path)
    assert client.get(f"/api/meetings/{mid}/asr").json() == {"status": "none"}
    assert client.post(f"/api/meetings/{mid}/transcribe").status_code == 400  # no video yet

    client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})
    client.put(f"/api/meetings/{mid}/transcript", json={"segments": [{"text": "old"}]})
    calls: list[tuple] = []

    def fake(path: Path, audio_track: int, progress) -> dict:
        calls.append((path, audio_track))
        progress(1, 1)
        return {"status": "done", "segments": [{"id": "asr-1", "start": 0.0, "text": "ใหม่"}]}

    monkeypatch.setattr(asr, "transcribe_video", fake)
    assert client.post(f"/api/meetings/{mid}/transcribe").status_code == 200
    done = wait_done(client, mid)
    assert done["status"] == "done" and done["segmentCount"] == 1 and "segments" not in done
    assert calls == [(video.resolve(), 0)]
    assert [s["text"] for s in client.get(f"/api/meetings/{mid}").json()["segments"]] == ["ใหม่"]
    history = client.get(f"/api/meetings/{mid}/history").json()
    assert any("asr" in h["name"] for h in history["snapshots"])


def test_failures_keep_the_transcript_and_only_one_run_at_a_time(
    tmp_path: Path, monkeypatch
) -> None:
    client, mid, video = setup(tmp_path)
    client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})
    client.put(f"/api/meetings/{mid}/transcript", json={"segments": [{"text": "keep"}]})

    def missing(*_args) -> dict:
        raise asr.AsrUnavailable("ASR model not installed")

    monkeypatch.setattr(asr, "transcribe_video", missing)
    client.post(f"/api/meetings/{mid}/transcribe")
    assert wait_done(client, mid)["status"] == "unavailable"
    assert client.get(f"/api/meetings/{mid}").json()["segments"] == [{"text": "keep"}]

    assert asr.try_start("other-meeting")
    try:
        busy = client.post(f"/api/meetings/{mid}/transcribe")
        assert busy.status_code == 400 and "already running" in busy.json()["detail"]
    finally:
        asr.finish("other-meeting")


def test_a_run_cut_off_by_a_restart_shows_as_failed(tmp_path: Path) -> None:
    client, mid, _ = setup(tmp_path)
    mdir = next((tmp_path / "PlainMarkData").rglob(f"{mid}/meeting.json")).parent
    (mdir / "asr.json").write_text(json.dumps({"status": "running"}), encoding="utf-8")
    state = client.get(f"/api/meetings/{mid}/asr").json()
    assert state["status"] == "failed" and "Interrupted" in state["error"]
