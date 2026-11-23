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


def test_captures_become_sorted_keyframes_and_can_be_deleted(tmp_path: Path) -> None:
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
    assert frames[0]["ocrStatus"] == "pending"
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
