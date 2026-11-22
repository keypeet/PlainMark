"""Phase 1.5a tests: WordSeg FTS5, 5k perf, Inbox backup, Nightly backup, Privacy & APIs."""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app import backup, db, wordseg
from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    app = create_app(data_root=tmp_path / "PlainMarkData")
    return TestClient(app)


def test_wordseg_guard_glossary_and_fallback() -> None:
    # Pre-tokenizer guard preserves URLs and emails intact
    text = "ส่งงานให้ alice.dev@plainmark.io ที่ https://docs.plainmark.local/v2/guide?tab=1 นะครับ"
    tokens = wordseg.tokenize_text(text)
    assert "alice.dev@plainmark.io" in tokens
    assert "https://docs.plainmark.local/v2/guide?tab=1" in tokens

    # Glossary user_words & batch_chars=0 consistency
    phrase = "ระบบไอโอทีและดิจิทัลทวิน"
    t1 = wordseg.tokenize_text(phrase, user_words=["ไอโอที", "ดิจิทัลทวิน"])
    t2 = wordseg.tokenize_query(phrase, user_words=["ไอโอที", "ดิจิทัลทวิน"])
    assert t1 == t2

    # Fallback engine (PyThaiNLP newmm) works cleanly
    fb_tokens = wordseg.tokenize_text("ทดสอบค้นหางานและเงิน", engine="newmm")
    assert "งาน" in fb_tokens
    assert "เงิน" in fb_tokens


def test_fts5_performance_budget_5000_notes(tmp_path: Path) -> None:
    db_path = tmp_path / "perf.sqlite"
    rows = []
    # Pre-segment once for bulk fixture setup; measure query latency strictly on 5,000 rows
    filler_seg = wordseg.segment_for_fts("บันทึกการทำงานประจำวันของระบบภายในองค์กร")
    for i in range(5000):
        if i == 1234:
            title = "แผนงานการเงินไตรมาส 4"
            content = "สรุปงานและเงินสำหรับโปรเจคหลัก ติดต่อ finance@plainmark.dev หรือ https://plainmark.dev/q4"
            t_seg = wordseg.segment_for_fts(title)
            c_seg = wordseg.segment_for_fts(content)
        else:
            title = f"บันทึกประจำวัน {i}"
            content = f"รายละเอียดรอบที่ {i} บันทึกการทำงานประจำวันของระบบภายในองค์กร"
            t_seg = f"บันทึก ประจำ วัน {i}"
            c_seg = f"ราย ละเอียด รอบ ที่ {i} {filler_seg}"
        rows.append(
            {
                "rel_path": f"projects/Perf/notes/note-{i}.md",
                "scope": "project:Perf",
                "project_slug": "Perf",
                "project_name": "Perf",
                "hidden": False,
                "title": title,
                "content": content,
                "title_seg": t_seg,
                "content_seg": c_seg,
                "created_at": 1700000000000 + i,
                "updated_at": 1700000000000 + i,
            }
        )

    db.rebuild_index_from_disk(db_path, rows)

    with db.connect(db_path) as conn:
        for q in ("งาน", "เงิน", "แผนงานการเงิน", "finance@plainmark.dev", "https://plainmark.dev/q4"):
            t0 = time.perf_counter()
            hits = db.search_notes(conn, q, limit=30)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            assert len(hits) >= 1, f"Expected hit for query: {q}"
            assert hits[0]["path"] == "projects/Perf/notes/note-1234.md" or any(
                h["path"] == "projects/Perf/notes/note-1234.md" for h in hits
            )
            assert elapsed_ms < 80.0, f"Query '{q}' took {elapsed_ms:.2f} ms (>= 80 ms)"


def test_legacy_inbox_backup_to_scratch_and_rebuild_index(tmp_path: Path) -> None:
    root = tmp_path / "PlainMarkData"
    inbox_notes = root / "projects" / "Inbox" / "notes"
    inbox_notes.mkdir(parents=True, exist_ok=True)
    orig_file = inbox_notes / "legacy-idea.md"
    orig_file.write_text("# Legacy Inbox\nห้ามย้ายเข้า general/notes", encoding="utf-8")

    app = create_app(data_root=root)
    client = TestClient(app)

    # Original stays in projects/Inbox/notes, NOT moved to general/notes
    assert orig_file.is_file()
    assert not (root / "general" / "notes" / "legacy-idea.md").exists()

    # Backup copied to scratch/inbox-backup-<stem>.md
    backup_file = root / "scratch" / "inbox-backup-legacy-idea.md"
    assert backup_file.is_file()
    assert "Legacy Inbox" in backup_file.read_text(encoding="utf-8")

    # Idempotent across re-init (no duplicate files)
    app2 = create_app(data_root=root)
    assert app2 is not None
    scratch_files = list((root / "scratch").glob("*.md"))
    assert len(scratch_files) == 1

    # Derived Index Guarantee: delete sqlite & rebuild from disk
    db_file = root / "plainmark.sqlite"
    assert db_file.is_file()
    db_file.unlink()
    rebuilt = client.post("/api/index/rebuild")
    assert rebuilt.status_code == 200
    assert rebuilt.json()["indexedNotes"] >= 1
    hits = client.get("/api/search", params={"q": "Legacy Inbox"}).json()["results"]
    assert any(h["path"] == "projects/Inbox/notes/legacy-idea.md" for h in hits)


def test_nightly_backup_skips_sqlite_and_media_and_rotates(tmp_path: Path) -> None:
    data_root = tmp_path / "PlainMarkData"
    dest_root = tmp_path / "Backups"
    create_app(data_root=data_root)

    (data_root / "general" / "notes" / "keep.md").write_text("keep me", encoding="utf-8")
    (data_root / "general" / "meetings" / "big.mp4").write_bytes(b"0" * 100)
    (data_root / "general" / "meetings" / "raw.mkv").write_bytes(b"0" * 100)
    (data_root / "general" / "meetings" / "audio.wav").write_bytes(b"0" * 100)

    base_day = datetime(2026, 11, 1, 2, 0, 0)  # Sunday
    for offset in range(10):
        res = backup.run_backup(
            data_root,
            dest_root,
            keep_daily=7,
            keep_weekly=4,
            now=base_day + timedelta(days=offset),
        )
        assert res["backedUpFiles"] >= 1
        assert res["skippedFiles"] >= 4  # sqlite + mp4 + mkv + wav

    daily_dirs = sorted((dest_root / "daily").iterdir())
    assert len(daily_dirs) == 7
    latest = daily_dirs[-1]
    assert (latest / "general" / "notes" / "keep.md").is_file()
    assert not (latest / "plainmark.sqlite").exists()
    assert not (latest / "general" / "meetings" / "big.mp4").exists()
    assert not (latest / "general" / "meetings" / "raw.mkv").exists()
    assert not (latest / "general" / "meetings" / "audio.wav").exists()

    # Weekly rotation (run 5 distinct weeks -> keeps 4)
    for w in range(5):
        backup.run_backup(
            data_root,
            dest_root,
            keep_daily=7,
            keep_weekly=4,
            now=base_day + timedelta(weeks=w),
        )
    weekly_dirs = list((dest_root / "weekly").iterdir())
    assert len(weekly_dirs) == 4


def test_scopes_hidden_projects_move_and_scratches(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    # Create normal project + hidden project
    client.post("/api/projects", json={"name": "Alpha", "glossary": ["PlainMark"]})
    client.post("/api/projects", json={"name": "Secret", "hidden": True})

    # Create notes in general, Alpha, Secret
    g_note = client.post(
        "/api/notes", json={"scope": "general", "title": "General Note"}
    ).json()
    a_note = client.post(
        "/api/notes", json={"scope": "project:Alpha", "title": "Alpha Note"}
    ).json()
    s_note = client.post(
        "/api/notes", json={"scope": "project:Secret", "title": "Secret Note"}
    ).json()

    client.post(
        "/api/notes/write", json={"path": g_note["path"], "content": "sharedkeyword general"}
    )
    client.post(
        "/api/notes/write", json={"path": a_note["path"], "content": "sharedkeyword alpha"}
    )
    client.post(
        "/api/notes/write", json={"path": s_note["path"], "content": "sharedkeyword secret"}
    )

    # Search all excludes hidden projects by default
    all_hits = client.get(
        "/api/search", params={"q": "sharedkeyword", "scope": "all"}
    ).json()["results"]
    paths = {h["path"] for h in all_hits}
    assert g_note["path"] in paths
    assert a_note["path"] in paths
    assert s_note["path"] not in paths

    # Move General -> Project Alpha -> General
    moved_to_alpha = client.post(
        "/api/move",
        json={"itemType": "note", "idOrPath": g_note["path"], "targetScope": "project:Alpha"},
    )
    assert moved_to_alpha.status_code == 200
    assert moved_to_alpha.json()["scope"] == "project:Alpha"

    moved_back = client.post(
        "/api/move",
        json={
            "itemType": "note",
            "idOrPath": moved_to_alpha.json()["path"],
            "targetScope": "general",
        },
    )
    assert moved_back.status_code == 200
    assert moved_back.json()["scope"] == "general"

    # Scratches CRUD + promote + NOT counted in source_hash
    sync_before = client.post("/api/sync/smart", json={"scope": "general"}).json()["results"][0]
    hash_before = sync_before["source_hash"]

    sc = client.post(
        "/api/scratches", json={"title": "prompt-draft", "content": "draft prompt"}
    ).json()
    assert sc["id"] == "prompt-draft"
    client.put("/api/scratches/prompt-draft", json={"content": "updated prompt"})

    sync_after_scratch = client.post(
        "/api/sync/smart", json={"scope": "general"}
    ).json()["results"][0]
    assert sync_after_scratch["status"] == "skipped"
    assert sync_after_scratch["tokensUsed"] == 0
    assert sync_after_scratch["source_hash"] == hash_before

    promoted = client.post(
        "/api/scratches/prompt-draft/promote",
        json={"targetScope": "project:Alpha", "title": "Promoted Prompt", "keepScratch": False},
    )
    assert promoted.status_code == 200
    assert promoted.json()["deletedScratch"] is True
    assert promoted.json()["note"]["scope"] == "project:Alpha"


def test_board_closed_items_settings_and_smart_sync_provenance(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    # Board CRUD
    board_put = client.put(
        "/api/board",
        params={"scope": "general"},
        json={
            "mode": "columns",
            "columns": [{"id": "todo", "title": "ต้องทำต่อ"}, {"id": "custom", "title": "รอตรวจ"}],
            "cards": [
                {"id": "c1", "columnId": "todo", "text": "เช็กสเปก", "color": "#fef3c7", "links": []}
            ],
            "customColors": ["#e0f2fe"],
        },
    )
    assert board_put.status_code == 200
    assert len(board_put.json()["cards"]) == 1

    # Closed items + restore
    closed = client.post(
        "/api/closed-items",
        json={
            "itemType": "card",
            "scope": "general",
            "title": "การ์ดที่ปิด",
            "reason": "done",
            "assignee": "Key",
            "snapshot": {"id": "c2", "columnId": "todo", "text": "กู้คืนได้"},
        },
    ).json()
    restored = client.post(f"/api/closed-items/{closed['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["item"]["restored"] is True
    assert len(client.get("/api/board", params={"scope": "general"}).json()["cards"]) == 2

    # Settings defaults (local lms) & CLI discovery
    settings = client.get("/api/settings").json()["settings"]
    assert settings["aiDefaults"]["insights"]["provider"] == "lms"
    assert settings["privacy"]["defaultMeetingVisibility"] == "local_only"
    cli = client.post("/api/cli/discover")
    assert cli.status_code == 200
    assert "lms" in cli.json()["clis"]

    # Smart sync provenance + reserved inbox/broken ignored
    root = tmp_path / "PlainMarkData"
    (root / "general" / "meetings" / "inbox" / "pending-1").mkdir(parents=True, exist_ok=True)
    (root / "general" / "meetings" / "inbox" / "pending-1" / "meeting.json").write_text(
        '{"id": "pending-1", "title": "Unconfirmed"}', encoding="utf-8"
    )
    (root / "general" / "meetings" / "broken" / "bad-1").mkdir(parents=True, exist_ok=True)
    (root / "general" / "meetings" / "broken" / "bad-1" / "meeting.json").write_text(
        '{"id": "bad-1", "title": "Broken"}', encoding="utf-8"
    )

    meetings_payload = client.get("/api/meetings", params={"scope": "general"}).json()
    assert meetings_payload["total"] == 0
    assert len(meetings_payload["inboxItems"]) == 1
    assert meetings_payload["inboxItems"][0]["id"] == "pending-1"
    assert len(meetings_payload["brokenItems"]) == 1
    assert meetings_payload["brokenItems"][0]["id"] == "bad-1"

    first_sync = client.post("/api/sync/smart", json={"scope": "general"}).json()["results"][0]
    assert first_sync["status"] == "synced"
    prov = first_sync["insights"]["provenance"]
    for field in ("provider", "model", "effort", "prompt_version", "generated_at", "source_hash"):
        assert field in prov

    second_sync = client.post("/api/sync/smart", json={"scope": "general"}).json()["results"][0]
    assert second_sync["status"] == "skipped"
    assert second_sync["tokensUsed"] == 0


def test_privacy_gate_and_scope_isolated_assistant(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    client.post("/api/projects", json={"name": "ProjA"})
    client.post("/api/projects", json={"name": "ProjB"})

    n_b = client.post("/api/notes", json={"scope": "project:ProjB", "title": "Secret B"}).json()
    client.post(
        "/api/notes/write", json={"path": n_b["path"], "content": "ProjB confidential note"}
    )

    # Create local_only (default) and shareable meetings in ProjA
    client.post(
        "/api/meetings",
        json={
            "scope": "project:ProjA",
            "title": "Private Sync",
            "date": "2026-11-22",
            "summary": "คุยกับ Somchai somchai@company.com เรื่องงบ",
            "participants": [
                {"speakerId": "spk_0", "name": "Somchai", "email": "somchai@company.com"}
            ],
        },
    )
    client.post(
        "/api/meetings",
        json={
            "scope": "project:ProjA",
            "title": "Public Demo",
            "date": "2026-11-22",
            "visibility": "shareable",
            "summary": "เดโมกับ Somchai somchai@company.com",
            "participants": [
                {"speakerId": "spk_0", "name": "Somchai", "email": "somchai@company.com"}
            ],
        },
    )

    # Cloud CLI query in ProjA: filters local_only, redacts PII, and does NOT leak ProjB
    cloud_res = client.post(
        "/api/assistant/query",
        json={"query": "สรุปประชุม", "scope": "project:ProjA", "provider": "claude"},
    ).json()
    assert cloud_res["filteredLocalOnlyMeetings"] == 1
    assert cloud_res["redacted"] is True
    assert len(cloud_res["sources"]["meetings"]) == 1
    assert cloud_res["sources"]["meetings"][0]["title"] == "Public Demo"
    assert "[REDACTED_EMAIL]" in cloud_res["sources"]["meetings"][0]["summary"]
    assert "[REDACTED_NAME]" in cloud_res["sources"]["meetings"][0]["summary"]
    assert all(n["scope"] == "project:ProjA" for n in cloud_res["sources"]["notes"])

    # Local provider sees both meetings unredacted
    local_res = client.post(
        "/api/assistant/query",
        json={"query": "สรุปประชุม", "scope": "project:ProjA", "provider": "lms"},
    ).json()
    assert local_res["filteredLocalOnlyMeetings"] == 0
    assert len(local_res["sources"]["meetings"]) == 2


def test_meetings_pagination_history_voiceprints_contacts_knowledge(tmp_path: Path) -> None:
    client = make_client(tmp_path)

    # Create 205 meetings to test pagination (200+ requirement)
    for i in range(205):
        res = client.post(
            "/api/meetings",
            json={
                "id": f"mtg-{i:03d}",
                "scope": "general",
                "date": "2026-11-22",
                "startTime": f"{(i // 60) % 24:02d}:{i % 60:02d}",
                "segments": [{"speakerId": "spk_0", "text": f"line {i}"}],
            },
        )
        assert res.status_code == 200

    page1 = client.get("/api/meetings", params={"limit": 50, "offset": 0}).json()
    page5 = client.get("/api/meetings", params={"limit": 50, "offset": 200}).json()
    assert page1["total"] == 205
    assert len(page1["items"]) == 50
    assert len(page5["items"]) == 5

    # Transcript edit & speaker rename create .history/ snapshots
    client.put(
        "/api/meetings/mtg-000/transcript",
        json={"segments": [{"speakerId": "spk_0", "text": "edited line"}], "reason": "fix-typo"},
    )
    client.post(
        "/api/meetings/mtg-000/rename-speaker",
        json={"oldSpeakerId": "spk_0", "newName": "Key"},
    )
    hist = client.get("/api/meetings/mtg-000/history").json()["snapshots"]
    assert len(hist) == 2
    mtg = client.get("/api/meetings/mtg-000").json()
    assert mtg["segments"][0]["speakerName"] == "Key"

    # Voiceprints CRUD + Forget Speaker (embedding-only)
    bad_vp = client.post("/api/voiceprints", json={"name": "X", "audioBytes": "raw"})
    assert bad_vp.status_code == 400
    vp = client.post(
        "/api/voiceprints",
        json={"id": "vp-key", "name": "Key", "embedding": [0.1, 0.2, 0.3]},
    )
    assert vp.status_code == 200
    assert len(client.get("/api/voiceprints").json()["voiceprints"]) == 1
    assert client.delete("/api/voiceprints/vp-key").status_code == 200
    assert len(client.get("/api/voiceprints").json()["voiceprints"]) == 0

    # Contacts CRUD
    contact = client.post(
        "/api/contacts", json={"name": "Alice", "nickname": "Al", "email": "alice@example.com"}
    ).json()
    assert len(client.get("/api/contacts").json()["contacts"]) == 1
    assert client.delete(f"/api/contacts/{contact['id']}").status_code == 200

    # Knowledge CRUD (read/unread + date filter)
    k1 = client.post(
        "/api/knowledge",
        json={"scope": "general", "title": "Doc 1", "url": "https://a.com", "date": "2026-11-20"},
    ).json()
    client.post(
        "/api/knowledge",
        json={
            "scope": "general",
            "title": "Doc 2",
            "url": "https://b.com",
            "date": "2026-11-22",
            "read": True,
        },
    )
    unread = client.get("/api/knowledge", params={"read": False}).json()["items"]
    assert len(unread) == 1
    assert unread[0]["id"] == k1["id"]
    by_date = client.get("/api/knowledge", params={"date": "2026-11-22"}).json()["items"]
    assert len(by_date) == 1
