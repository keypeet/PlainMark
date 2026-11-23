"""Meeting media: videos linked in place from the recording folder, captures saved as keyframes."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def setup(tmp_path: Path) -> tuple[TestClient, Path, str]:
    client = TestClient(create_app(data_root=tmp_path / "PlainMarkData"))
    media = tmp_path / "Videos"
    (media / "Meetings").mkdir(parents=True)
    client.put("/api/settings", json={"meetingsWatch": {"watchPath": str(media)}})
    meeting = client.post("/api/meetings", json={"title": "Weekly", "scope": "general"}).json()
    return client, media, meeting["id"]


def test_lists_and_streams_videos_only_inside_recording_folder(tmp_path: Path) -> None:
    client, media, _ = setup(tmp_path)
    video = media / "Meetings" / "2026-11-23 10-27-57.mp4"
    video.write_bytes(b"0123456789" * 100)
    (media / "Meetings" / "notes.txt").write_text("x")
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"secret")

    listing = client.get("/api/media/videos").json()
    assert [i["name"] for i in listing["items"]] == ["2026-11-23 10-27-57.mp4"]
    assert listing["items"][0]["folder"] == "Meetings"

    ranged = client.get(
        "/api/media/file", params={"path": str(video)}, headers={"Range": "bytes=0-9"}
    )
    assert ranged.status_code == 206
    assert ranged.content == b"0123456789"

    assert client.get("/api/media/file", params={"path": str(outside)}).status_code == 400
    escape = str(media / ".." / "outside.mp4")
    assert client.get("/api/media/file", params={"path": escape}).status_code == 400
    txt = str(media / "Meetings" / "notes.txt")
    assert client.get("/api/media/file", params={"path": txt}).status_code == 400


def test_meeting_links_video_in_place(tmp_path: Path) -> None:
    client, media, mid = setup(tmp_path)
    video = media / "Meetings" / "rec.mp4"
    video.write_bytes(b"x")

    linked = client.patch(f"/api/meetings/{mid}", json={"videoPath": str(video)})
    assert linked.status_code == 200
    assert linked.json()["videoPath"] == str(video.resolve())
    assert video.is_file()

    bad = client.patch(f"/api/meetings/{mid}", json={"videoPath": str(tmp_path / "x.mp4")})
    assert bad.status_code == 400
    assert client.patch(f"/api/meetings/{mid}", json={"videoPath": ""}).json()["videoPath"] == ""


def test_captures_become_sorted_keyframes_and_can_be_deleted(tmp_path: Path, monkeypatch) -> None:
    from app import ocr as ocr_module

    monkeypatch.setattr(ocr_module, "read_png", lambda data: "")
    client, _, mid = setup(tmp_path)

    later = client.post(
        f"/api/meetings/{mid}/captures",
        files={"file": ("a.png", PNG_BYTES, "image/png")},
        data={"timeSec": "3725.4", "kind": "frame"},
    )
    assert later.status_code == 200
    ocr = client.post(
        f"/api/meetings/{mid}/captures",
        files={"file": ("b.png", PNG_BYTES, "image/png")},
        data={"timeSec": "65", "kind": "ocr", "region": '{"x": 10, "y": 20, "w": 300, "h": 80}'},
    ).json()

    frames = ocr["keyframes"]
    assert [f["timestamp"] for f in frames] == ["01:05", "1:02:05"]
    assert frames[0]["kind"] == "ocr"
    assert frames[0]["ocrStatus"] == "done"
    assert frames[0]["region"] == {"x": 10, "y": 20, "w": 300, "h": 80}

    image = client.get(frames[1]["imageUrl"])
    assert image.status_code == 200
    assert image.content == PNG_BYTES

    not_png = client.post(
        f"/api/meetings/{mid}/captures",
        files={"file": ("c.png", b"GIF89a", "image/png")},
        data={"timeSec": "1"},
    )
    assert not_png.status_code == 400
    assert client.get(f"/api/meetings/{mid}/captures/meeting.json").status_code == 400

    after = client.delete(f"/api/meetings/{mid}/keyframes/{frames[1]['id']}").json()
    assert [f["id"] for f in after["keyframes"]] == [frames[0]["id"]]
    assert client.get(frames[1]["imageUrl"]).status_code == 404


def test_region_capture_is_read_by_ocr_and_searchable(tmp_path: Path, monkeypatch) -> None:
    from app import ocr

    monkeypatch.setattr(ocr, "read_png", lambda data: "Executive Summary\nใช้ AI 73%")
    client, _, mid = setup(tmp_path)

    res = client.post(
        f"/api/meetings/{mid}/captures",
        files={"file": ("a.png", PNG_BYTES, "image/png")},
        data={"timeSec": "65", "kind": "ocr"},
    ).json()
    frame = res["keyframes"][0]
    assert frame["ocrStatus"] == "done"
    assert frame["ocrText"] == "Executive Summary\nใช้ AI 73%"

    found = client.get("/api/meetings", params={"q": "executive summary"}).json()
    assert [m["id"] for m in found["items"]] == [mid]

    plain = client.post(
        f"/api/meetings/{mid}/captures",
        files={"file": ("b.png", PNG_BYTES, "image/png")},
        data={"timeSec": "70", "kind": "frame"},
    ).json()
    assert "ocrStatus" not in plain["keyframes"][1]


def test_missing_ocr_model_is_reported_and_can_be_retried(tmp_path: Path, monkeypatch) -> None:
    from app import ocr

    def unavailable(data: bytes) -> str:
        raise ocr.OcrUnavailable("OCR model not installed")

    monkeypatch.setattr(ocr, "read_png", unavailable)
    client, _, mid = setup(tmp_path)
    frame = client.post(
        f"/api/meetings/{mid}/captures",
        files={"file": ("a.png", PNG_BYTES, "image/png")},
        data={"timeSec": "5", "kind": "ocr"},
    ).json()["keyframes"][0]
    assert frame["ocrStatus"] == "unavailable"
    assert "not installed" in frame["ocrError"]

    monkeypatch.setattr(ocr, "read_png", lambda data: "พร้อมแล้ว")
    retried = client.post(f"/api/meetings/{mid}/keyframes/{frame['id']}/ocr").json()
    assert retried["keyframes"][0]["ocrStatus"] == "done"
    assert retried["keyframes"][0]["ocrText"] == "พร้อมแล้ว"
    assert "ocrError" not in retried["keyframes"][0]
    assert client.post(f"/api/meetings/{mid}/keyframes/cap-1-abcdef/ocr").status_code == 404


def test_ocr_install_refuses_files_with_wrong_checksum(tmp_path: Path) -> None:
    import pytest

    from app import ocr

    source = tmp_path / "src"
    for name in ocr.MODEL_FILES:
        (source / name).parent.mkdir(parents=True, exist_ok=True)
        (source / name).write_bytes(b"not the real file")
    target = tmp_path / "model"
    with pytest.raises(ValueError, match="Checksum mismatch"):
        ocr.install(target, source)
    assert not ocr.model_ready(target)
