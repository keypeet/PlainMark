"""Speaker diarization: turns from model probabilities, the user's mic track, the meeting API."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import diarize
from app.main import create_app


def probs_with(spans: dict[int, list[tuple[float, float]]], seconds: float) -> np.ndarray:
    p = np.zeros((int(seconds * 100), diarize.N_SPK), np.float32)
    for spk, ranges in spans.items():
        for a, b in ranges:
            p[int(a * 100) : int(b * 100), spk] = 0.9
    return p


def test_turns_merge_short_gaps_drop_blips_and_rank_speakers_by_talk_time() -> None:
    p = probs_with({0: [(0, 1), (1.2, 4)], 1: [(5, 11)], 2: [(12, 12.1)], 3: [(13, 14)]}, 15)
    raw = diarize.to_turns(p)
    assert [(s, round(a, 2), round(b, 2)) for s, a, b in raw] == [
        (0, 0.0, 4.0),
        (1, 5.0, 11.0),
        (3, 13.0, 14.0),
    ]

    speakers, turns = diarize.summarize(raw, 15.0)
    assert [s["id"] for s in speakers] == ["spk1", "spk2"]  # slot 3 talks 1 s: model noise
    assert speakers[0]["talkSec"] == 6.0 and speakers[0]["share"] == pytest.approx(0.6, abs=1e-3)
    assert turns == [
        {"speakerId": "spk2", "start": 0.0, "end": 4.0},
        {"speakerId": "spk1", "start": 5.0, "end": 11.0},
    ]


def test_mic_track_marks_the_matching_speaker_only_when_it_clearly_matches() -> None:
    turns = [
        {"speakerId": "spk1", "start": 0.0, "end": 20.0},
        {"speakerId": "spk2", "start": 20.0, "end": 30.0},
    ]
    mic = np.zeros(30 * diarize.SR, np.float32)
    mic[21 * diarize.SR : 29 * diarize.SR] = 0.1  # the user talks during spk2's turn
    assert diarize.find_me(turns, diarize.mic_active(mic)) == "spk2"

    silent = np.zeros(30 * diarize.SR, np.float32)
    assert diarize.find_me(turns, diarize.mic_active(silent)) is None


def test_chunk_loop_covers_every_frame_and_keeps_the_cache_bounded() -> None:
    seen: list[int] = []

    def fake_run(feed: dict) -> list:
        cached = feed["cached_embeds"].shape[1]
        n_mel = feed["input_features"].shape[1]
        n_emb = -(-n_mel // diarize.SUB)
        assert feed["attention_mask"].shape == (1, cached + n_emb)
        seen.append(cached)
        logits = np.full((1, (cached + n_emb) * diarize.SUB, diarize.N_SPK), -5.0, np.float32)
        logits[..., 0] = 5.0
        rng = np.random.default_rng(len(seen))
        embeds = rng.standard_normal((1, n_emb, 512)).astype(np.float32)
        return [logits, embeds, np.zeros(512, np.float32)]

    audio = np.random.default_rng(0).standard_normal(100 * diarize.SR).astype(np.float32) * 0.01
    probs = diarize.speaker_probs(audio, run=fake_run)
    assert probs.shape == (len(audio) // diarize.HOP, diarize.N_SPK)
    assert (probs[:, 0] > 0.99).all() and (probs[:, 1:] < 0.01).all()
    assert len(seen) == 4  # 100 s in chunks of 340 encoder frames (27.2 s)
    assert max(seen) <= diarize.CACHE_LEN + diarize.FIFO_LEN


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
        state = client.get(f"/api/meetings/{mid}/diarization").json()
        if state["status"] != "running":
            return state
        time.sleep(0.02)
    raise AssertionError("diarization did not finish")


def test_api_runs_diarization_in_background_and_stores_the_result(
    tmp_path: Path, monkeypatch
) -> None:
    client, mid, video = setup(tmp_path)
    assert client.get(f"/api/meetings/{mid}/diarization").json() == {"status": "none"}
    assert client.post(f"/api/meetings/{mid}/diarize").status_code == 400  # no video linked yet

    client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})
    calls: list[tuple] = []

    def fake(path: Path, audio_track: int, mic_track: int | None) -> dict:
        calls.append((path, audio_track, mic_track))
        return {
            "status": "done",
            "speakers": [{"id": "spk1", "talkSec": 3.0, "share": 1.0, "isMe": True}],
            "turns": [{"speakerId": "spk1", "start": 0.0, "end": 3.0}],
        }

    monkeypatch.setattr(diarize, "diarize_video", fake)
    started = client.post(f"/api/meetings/{mid}/diarize", json={"audioTrack": 1, "micTrack": 2})
    assert started.status_code == 200
    done = wait_done(client, mid)
    assert done["status"] == "done" and done["speakers"][0]["isMe"] is True
    assert "finishedAt" in done
    assert calls == [(video.resolve(), 0, 1)]


def test_failures_are_reported_and_only_one_run_at_a_time(tmp_path: Path, monkeypatch) -> None:
    client, mid, video = setup(tmp_path)
    client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})

    def missing(*_args) -> dict:
        raise diarize.DiarizeUnavailable("Diarization model not installed")

    monkeypatch.setattr(diarize, "diarize_video", missing)
    client.post(f"/api/meetings/{mid}/diarize")
    assert wait_done(client, mid)["status"] == "unavailable"

    assert diarize.try_start("other-meeting")
    try:
        busy = client.post(f"/api/meetings/{mid}/diarize")
        assert busy.status_code == 400 and "already running" in busy.json()["detail"]
    finally:
        diarize.finish("other-meeting")


def test_a_run_cut_off_by_a_restart_shows_as_failed(tmp_path: Path) -> None:
    client, mid, _ = setup(tmp_path)
    mdir = next((tmp_path / "PlainMarkData").rglob(f"{mid}/meeting.json")).parent
    (mdir / "diarization.json").write_text(json.dumps({"status": "running"}), encoding="utf-8")
    state = client.get(f"/api/meetings/{mid}/diarization").json()
    assert state["status"] == "failed" and "Interrupted" in state["error"]


def test_install_refuses_model_files_with_wrong_checksum(tmp_path: Path) -> None:
    source = tmp_path / "src"
    for name in diarize.MODEL_FILES:
        (source / name).parent.mkdir(parents=True, exist_ok=True)
        (source / name).write_bytes(b"not the model")
    with pytest.raises(ValueError, match="Checksum mismatch"):
        diarize.install(tmp_path / "models", source)
    assert not diarize.model_ready(tmp_path / "models")


def test_segments_get_the_speaker_who_talks_most_during_them() -> None:
    turns = [
        {"speakerId": "spk1", "start": 0.0, "end": 6.0},
        {"speakerId": "spk2", "start": 5.0, "end": 12.0},
    ]
    segments = [
        {"start": 0.5, "end": 4.0, "text": "a", "speakerName": "old"},
        {"start": 4.0, "end": 11.0, "text": "b"},  # spk1 2 s, spk2 6 s
        {"start": 20.0, "end": 22.0, "text": "c", "speakerId": "spk1"},  # nobody talks here
        {"text": "typed by hand", "speaker": "Bo"},
    ]
    out = diarize.assign_speakers(segments, turns)
    assert out == [
        {"start": 0.5, "end": 4.0, "text": "a", "speakerId": "spk1"},
        {"start": 4.0, "end": 11.0, "text": "b", "speakerId": "spk2"},
        {"start": 20.0, "end": 22.0, "text": "c"},
        {"text": "typed by hand", "speaker": "Bo"},
    ]


def fake_diarization(_path: Path, _audio: int, _mic: int | None) -> dict:
    return {
        "status": "done",
        "speakers": [
            {"id": "spk1", "talkSec": 8.0, "share": 0.8, "isMe": False},
            {"id": "spk2", "talkSec": 2.0, "share": 0.2, "isMe": True},
        ],
        "turns": [
            {"speakerId": "spk1", "start": 0.0, "end": 8.0},
            {"speakerId": "spk2", "start": 8.0, "end": 10.0},
        ],
    }


def test_diarization_labels_an_existing_transcript_and_names_follow_the_speakers_tab(
    tmp_path: Path, monkeypatch
) -> None:
    client, mid, video = setup(tmp_path)
    client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})
    segments = [{"start": 1.0, "end": 3.0, "text": "a"}, {"start": 8.2, "end": 9.5, "text": "b"}]
    client.put(f"/api/meetings/{mid}/transcript", json={"segments": segments})

    monkeypatch.setattr(diarize, "diarize_video", fake_diarization)
    client.post(f"/api/meetings/{mid}/diarize")
    assert wait_done(client, mid)["status"] == "done"
    got = client.get(f"/api/meetings/{mid}").json()["segments"]
    assert [(s["speakerId"], s["speakerName"]) for s in got] == [
        ("spk1", "ผู้พูด 1"),
        ("spk2", "ผู้พูด 2"),
    ]

    client.post(f"/api/meetings/{mid}/diarization/speakers/spk1", json={"name": "Bo"})
    got = client.get(f"/api/meetings/{mid}").json()["segments"]
    assert got[0]["speakerName"] == "Bo"

    # renaming from the transcript names the diarized speaker, so both places agree
    client.post(
        f"/api/meetings/{mid}/rename-speaker",
        json={"oldSpeakerId": "spk2", "newName": "Mai"},
    )
    speakers = client.get(f"/api/meetings/{mid}/diarization").json()["speakers"]
    names = {s["id"]: s.get("name") for s in speakers}
    assert names == {"spk1": "Bo", "spk2": "Mai"}
    assert client.get(f"/api/meetings/{mid}").json()["segments"][1]["speakerName"] == "Mai"
