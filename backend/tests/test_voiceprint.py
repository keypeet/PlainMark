"""Voiceprints: per-speaker embeddings, matching people across meetings, naming, forgetting."""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import diarize, voiceprint
from app.main import create_app


def unit(*xs: float) -> list[float]:
    v = np.asarray(xs, np.float64)
    return list(v / np.linalg.norm(v))


def test_match_applies_sure_names_suggests_close_ones_and_never_reuses_a_person() -> None:
    saved = [
        {"id": "vp-ann", "name": "Ann", "embedding": unit(1, 0, 0)},
        {"id": "vp-bo", "name": "Bo", "embedding": unit(0, 1, 0)},
    ]
    speakers = [
        {"id": "spk1", "embedding": unit(1, 0.1, 0)},  # clearly Ann
        {"id": "spk2", "embedding": unit(0.9, 0.2, 0)},  # also close to Ann, but Ann is taken
        {"id": "spk3", "embedding": unit(0.5, 0.5, 0.7)},  # Bo at ~0.5: only a suggestion
    ]
    voiceprint.match_speakers(speakers, saved)
    assert speakers[0]["voiceprintId"] == "vp-ann" and speakers[0]["name"] == "Ann"
    assert "voiceprintId" not in speakers[1]
    assert speakers[2].get("suggestedVoiceprintId") == "vp-bo" and "voiceprintId" not in speakers[2]


def test_merge_embedding_is_a_running_mean_of_unit_vectors() -> None:
    assert voiceprint.merge_embedding([], 0, [0.6, 0.8]) == [0.6, 0.8]
    merged = voiceprint.merge_embedding(unit(1, 0), 1, unit(0, 1))
    assert np.allclose(merged, unit(1, 1), atol=1e-5)


def test_embeddings_use_only_solo_speech(monkeypatch) -> None:
    seen: list[int] = []

    class FakeSession:
        def run(self, _outputs, feed):
            seen.append(feed["feats"].shape[1])
            return [np.ones((1, 256), np.float32)]

    monkeypatch.setattr(voiceprint, "_load_session", lambda: FakeSession())
    audio = np.random.default_rng(0).standard_normal(10 * voiceprint.SR).astype(np.float32) * 0.01
    turns = [
        {"speakerId": "spk1", "start": 0.0, "end": 5.0},
        {"speakerId": "spk2", "start": 4.0, "end": 8.0},  # overlaps spk1 for 4-5 s
        {"speakerId": "spk3", "start": 9.0, "end": 9.5},  # too short to embed
    ]
    out = voiceprint.speaker_embeddings(audio, turns, ["spk1", "spk2", "spk3"])
    assert set(out) == {"spk1", "spk2"}
    assert len(out["spk1"]) == 256
    assert seen == [298, 298]  # spk1 0-3 s (solo 0-4, capped at 3 s), spk2 5-8 s


def setup(tmp_path: Path, monkeypatch, embedding: list[float]) -> tuple[TestClient, Path]:
    client = TestClient(create_app(data_root=tmp_path / "PlainMarkData"))
    media = tmp_path / "Videos"
    media.mkdir()
    client.put("/api/settings", json={"meetingsWatch": {"watchPath": str(media)}})

    def fake(_video, _audio_track, _mic_track) -> dict:
        return {
            "status": "done",
            "voiceprints": "done",
            "speakers": [
                {"id": "spk1", "talkSec": 10.0, "share": 1.0, "isMe": False, "embedding": embedding}
            ],
            "turns": [{"speakerId": "spk1", "start": 0.0, "end": 10.0}],
        }

    monkeypatch.setattr(diarize, "diarize_video", fake)
    return client, media


def run_meeting(client: TestClient, media: Path, title: str) -> str:
    mid = client.post("/api/meetings", json={"title": title, "scope": "general"}).json()["id"]
    video = media / f"{title}.mp4"
    video.write_bytes(b"x")
    client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})
    assert client.post(f"/api/meetings/{mid}/diarize").status_code == 200
    for _ in range(100):
        if client.get(f"/api/meetings/{mid}/diarization").json()["status"] != "running":
            return mid
        time.sleep(0.02)
    raise AssertionError("diarization did not finish")


def test_named_and_remembered_speaker_is_recognised_in_the_next_meeting(
    tmp_path: Path, monkeypatch
) -> None:
    client, media = setup(tmp_path, monkeypatch, unit(1, 2, 3))
    first = run_meeting(client, media, "weekly-1")
    state = client.get(f"/api/meetings/{first}/diarization").json()
    assert state["speakers"][0]["canRemember"] is True
    assert "embedding" not in state["speakers"][0]  # embeddings never leave the backend

    named = client.post(
        f"/api/meetings/{first}/diarization/speakers/spk1", json={"name": "Ann", "remember": True}
    ).json()
    vp_id = named["speakers"][0]["voiceprintId"]
    saved = client.get("/api/voiceprints").json()["voiceprints"]
    assert [(v["id"], v["name"], v["samples"]) for v in saved] == [(vp_id, "Ann", 1)]

    second = run_meeting(client, media, "weekly-2")
    spk = client.get(f"/api/meetings/{second}/diarization").json()["speakers"][0]
    assert spk["name"] == "Ann" and spk["voiceprintId"] == vp_id

    client.post(
        f"/api/meetings/{second}/diarization/speakers/spk1", json={"name": "Ann", "remember": True}
    )
    assert client.get("/api/voiceprints").json()["voiceprints"][0]["samples"] == 2

    assert client.delete(f"/api/voiceprints/{vp_id}").status_code == 200  # Forget Speaker
    third = run_meeting(client, media, "weekly-3")
    assert "name" not in client.get(f"/api/meetings/{third}/diarization").json()["speakers"][0]


def test_naming_without_remember_saves_no_voiceprint(tmp_path: Path, monkeypatch) -> None:
    client, media = setup(tmp_path, monkeypatch, unit(3, 2, 1))
    mid = run_meeting(client, media, "one-off")
    res = client.post(f"/api/meetings/{mid}/diarization/speakers/spk1", json={"name": "Guest"})
    assert res.status_code == 200 and res.json()["speakers"][0]["name"] == "Guest"
    assert client.get("/api/voiceprints").json()["voiceprints"] == []
    missing = client.post(f"/api/meetings/{mid}/diarization/speakers/spk9", json={"name": "X"})
    assert missing.status_code == 404


@pytest.mark.parametrize("payload", [{"name": ""}, {"name": "A", "remember": "maybe"}])
def test_naming_rejects_bad_input(tmp_path: Path, monkeypatch, payload: dict) -> None:
    client, media = setup(tmp_path, monkeypatch, unit(1, 1, 1))
    mid = run_meeting(client, media, "bad")
    assert client.post(
        f"/api/meetings/{mid}/diarization/speakers/spk1", json=payload
    ).status_code in (
        400,
        422,
    )
