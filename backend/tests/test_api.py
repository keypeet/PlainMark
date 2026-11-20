"""API tests for PlainMark v2 backend."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    app = create_app(data_root=tmp_path / "PlainMarkData")
    return TestClient(app)


def test_health_and_default_project(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["modules"]["notes"] == "ready"

    proj_res = client.get("/api/projects")
    assert proj_res.status_code == 200
    projects = proj_res.json()["projects"]
    assert len(projects) == 1
    assert projects[0]["slug"] == "Inbox"


def test_project_and_note_lifecycle(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    # Create project
    p = client.post(
        "/api/projects",
        json={
            "name": "AI Roadmap",
            "repoPath": "C:/dev/personal/ai_agent",
            "glossary": ["OpenVINO"],
        },
    )
    assert p.status_code == 200
    assert p.json()["slug"] == "AI Roadmap"

    # Create note inside project
    n = client.post("/api/notes", json={"projectSlug": "AI Roadmap", "title": "แผนงานแรก"})
    assert n.status_code == 200
    note_path = n.json()["path"]
    assert note_path.endswith(".md")

    # Write note content
    w = client.post(
        "/api/notes/write",
        json={"path": note_path, "content": "# แผนงานแรก\nทดสอบค้นหาภาษาไทยและ OpenVINO"},
    )
    assert w.status_code == 200
    assert w.json()["saved"] is True

    # Read back
    r = client.get("/api/notes/read", params={"path": note_path})
    assert r.status_code == 200
    assert "OpenVINO" in r.json()["content"]

    # Search Thai substring & English word
    s_th = client.get("/api/search", params={"q": "ทดสอบค้นหา"})
    assert s_th.status_code == 200
    assert len(s_th.json()["results"]) == 1
    assert s_th.json()["results"][0]["path"] == note_path

    s_en = client.get("/api/search", params={"q": "OpenVINO"})
    assert s_en.status_code == 200
    assert len(s_en.json()["results"]) == 1

    # Upload image asset and verify serving + inline export
    up = client.post(
        "/api/notes/assets",
        data={"notePath": note_path},
        files={"file": ("shot.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
    )
    assert up.status_code == 200
    rel_img = up.json()["relativePath"]
    assert rel_img.startswith("แผนงานแรก.assets/")

    img_get = client.get("/api/notes/assets/file", params={"notePath": note_path, "rel": rel_img})
    assert img_get.status_code == 200
    assert img_get.content.startswith(b"\x89PNG")

    # Save content referencing image then rename note -> image folder & link follow
    client.post("/api/notes/write", json={"path": note_path, "content": f"![pic]({rel_img})"})
    renamed = client.post("/api/notes/rename", json={"path": note_path, "newTitle": "Renamed Note"})
    assert renamed.status_code == 200
    new_path = renamed.json()["path"]
    assert new_path != note_path

    # Ghost-file guard: writing to old path with mustExist=True must NOT recreate old file
    ghost = client.post(
        "/api/notes/write",
        json={"path": note_path, "content": "ghost", "mustExist": True},
    )
    assert ghost.status_code == 200
    assert ghost.json()["saved"] is False
    assert ghost.json()["reason"] == "missing"

    # Renamed note has updated asset link and inline-images embeds base64
    after_rename = client.get("/api/notes/read", params={"path": new_path}).json()["content"]
    assert "Renamed%20Note.assets/" in after_rename
    inlined = client.post(
        "/api/notes/inline-images", json={"path": new_path, "content": after_rename}
    )
    assert inlined.status_code == 200
    assert "data:image/png;base64," in inlined.json()["content"]

    # Move note to Inbox
    moved = client.post(
        "/api/notes/move", json={"path": new_path, "targetProjectSlug": "Inbox"}
    )
    assert moved.status_code == 200
    assert moved.json()["projectSlug"] == "Inbox"


def test_history_and_session_and_path_traversal(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    n = client.post("/api/notes", json={"projectSlug": "Inbox", "title": "hist"}).json()
    note_path = n["path"]

    # Save explicit snapshot
    snap = client.post(
        "/api/notes/history/save", json={"path": note_path, "content": "version 1"}
    )
    assert snap.status_code == 200
    assert snap.json()["saved"] is True

    snaps = client.get("/api/notes/history", params={"path": note_path}).json()["snapshots"]
    assert len(snaps) == 1
    snap_content = client.get(
        "/api/notes/history/read", params={"path": snaps[0]["path"]}
    ).json()["content"]
    assert snap_content == "version 1"

    # Session round-trip
    put_s = client.put("/api/session", json={"tabs": [{"id": "t1", "notePath": note_path}]})
    assert put_s.status_code == 200
    got_s = client.get("/api/session").json()["session"]
    assert got_s["tabs"][0]["notePath"] == note_path

    # Path traversal blocked
    bad = client.get("/api/notes/read", params={"path": "../../Windows/win.ini"})
    assert bad.status_code == 400
