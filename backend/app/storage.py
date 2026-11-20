"""Filesystem-first workspace storage with SQLite FTS5 mirror and atomic writes."""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import shutil
import threading
import time
import urllib.parse
import uuid
from datetime import datetime
from pathlib import Path

from . import db

NOTE_EXT = ".md"
HISTORY_DIR = ".history"
PROJECTS_DIR = "projects"
NOTES_SUBDIR = "notes"
DEFAULT_PROJECT_SLUG = "Inbox"
INVALID_FS_CHARS = re.compile(r'[\\/:*?"<>|]')
INLINE_IMAGE_RE = re.compile(r'!\[([^\]]*)\]\(([^)]+?)(\s+"[^"]*")?\)')
HAS_SCHEME_OR_ABS = re.compile(r"^(?:[a-z][a-z+.-]*:|/)", re.IGNORECASE)
SNAPSHOT_NAME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})\.md$")

MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}
EXT_TO_MIME = {ext: mime for mime, ext in MIME_TO_EXT.items()}


def sanitize_name(name: str, fallback: str = "untitled") -> str:
    cleaned = INVALID_FS_CHARS.sub("", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(".").strip()
    if cleaned in {"", ".", ".."}:
        return fallback
    return cleaned


def _now_ms() -> int:
    return int(time.time() * 1000)


def _file_created_ms(path: Path) -> int:
    try:
        st = path.stat()
        ts = getattr(st, "st_birthtime", None) or st.st_ctime or st.st_mtime
        return int(ts * 1000)
    except OSError:
        return 0


def _file_updated_ms(path: Path) -> int:
    try:
        return int(path.stat().st_mtime * 1000)
    except OSError:
        return 0


def _atomic_write_bytes(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _atomic_write_text(target: Path, text: str) -> None:
    _atomic_write_bytes(target, text.encode("utf-8"))


class WorkspaceStorage:
    """Manages projects, notes, snapshots, assets, session, and search index."""

    def __init__(self, data_root: Path) -> None:
        self.root = data_root.resolve()
        self.projects_root = self.root / PROJECTS_DIR
        self.session_file = self.root / "session.json"
        self.db_path = self.root / "plainmark.sqlite"
        self._op_lock = threading.RLock()
        self._last_snapshot_ms: dict[str, int] = {}
        self.ensure_initialized()

    def ensure_initialized(self) -> None:
        with self._op_lock:
            self.projects_root.mkdir(parents=True, exist_ok=True)
            if not any(p.is_dir() for p in self.projects_root.iterdir()):
                self._create_project_unlocked(DEFAULT_PROJECT_SLUG)
            self.rebuild_index()

    def _connect(self):
        return db.connect(self.db_path)

    def _rel(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def resolve_under_root(self, rel_path: str) -> Path:
        if not rel_path or rel_path.startswith(("/", "\\")):
            raise ValueError("Invalid relative path")
        normalized = rel_path.replace("\\", "/")
        candidate = (self.root / normalized).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Path escapes workspace root") from exc
        return candidate

    def _project_dir(self, slug: str) -> Path:
        safe = sanitize_name(slug, "")
        if not safe or safe != slug.strip():
            raise ValueError("Invalid project name")
        target = (self.projects_root / safe).resolve()
        target.relative_to(self.projects_root.resolve())
        return target

    def _project_meta_path(self, project_dir: Path) -> Path:
        return project_dir / "project.json"

    def _read_project_meta(self, project_dir: Path) -> dict:
        meta_path = self._project_meta_path(project_dir)
        slug = project_dir.name
        base = {
            "slug": slug,
            "name": slug,
            "createdAt": _file_created_ms(project_dir),
            "repoPath": None,
            "glossary": [],
        }
        if meta_path.is_file():
            try:
                loaded = json.loads(meta_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    base.update(
                        {
                            "name": str(loaded.get("name") or slug),
                            "createdAt": int(loaded.get("createdAt") or base["createdAt"]),
                            "repoPath": loaded.get("repoPath") or None,
                            "glossary": list(loaded.get("glossary") or []),
                        }
                    )
            except (OSError, ValueError, TypeError):
                pass
        return base

    def _write_project_meta(self, project_dir: Path, meta: dict) -> None:
        _atomic_write_text(
            self._project_meta_path(project_dir),
            json.dumps(meta, ensure_ascii=False, indent=2),
        )

    def _create_project_unlocked(
        self, name: str, *, repo_path: str | None = None, glossary: list[str] | None = None
    ) -> dict:
        slug = sanitize_name(name, "Project")
        project_dir = self.projects_root / slug
        notes_dir = project_dir / NOTES_SUBDIR
        notes_dir.mkdir(parents=True, exist_ok=True)
        meta = self._read_project_meta(project_dir)
        meta["slug"] = slug
        meta["name"] = name.strip() or slug
        if repo_path is not None:
            meta["repoPath"] = repo_path.strip() or None
        if glossary is not None:
            meta["glossary"] = [g.strip() for g in glossary if g.strip()]
        if not meta.get("createdAt"):
            meta["createdAt"] = _now_ms()
        self._write_project_meta(project_dir, meta)
        return meta

    def _unique_note_path(self, notes_dir: Path, stem: str) -> Path:
        safe_stem = sanitize_name(stem, "new note")
        candidate = notes_dir / f"{safe_stem}{NOTE_EXT}"
        counter = 2
        while candidate.exists():
            candidate = notes_dir / f"{safe_stem} ({counter}){NOTE_EXT}"
            counter += 1
        return candidate

    def _note_project_dir(self, note_file: Path) -> Path:
        # Expected: <root>/projects/<slug>/notes/<file>.md
        rel_parts = note_file.resolve().relative_to(self.projects_root.resolve()).parts
        if len(rel_parts) != 3 or rel_parts[1] != NOTES_SUBDIR:
            raise ValueError("Path is not a project note")
        return self.projects_root / rel_parts[0]

    def _index_note_file(self, conn, note_file: Path) -> None:
        if not note_file.is_file():
            return
        project_dir = self._note_project_dir(note_file)
        meta = self._read_project_meta(project_dir)
        try:
            content = note_file.read_text(encoding="utf-8")
        except OSError:
            return
        db.upsert_note(
            conn,
            rel_path=self._rel(note_file),
            project_slug=project_dir.name,
            project_name=meta["name"],
            title=note_file.stem,
            content=content,
            created_at=_file_created_ms(note_file),
            updated_at=_file_updated_ms(note_file),
        )

    def rebuild_index(self) -> int:
        with self._op_lock:
            rows: list[dict] = []
            if self.projects_root.is_dir():
                for project_dir in self.projects_root.iterdir():
                    if not project_dir.is_dir():
                        continue
                    notes_dir = project_dir / NOTES_SUBDIR
                    if not notes_dir.is_dir():
                        continue
                    meta = self._read_project_meta(project_dir)
                    for entry in notes_dir.iterdir():
                        if not entry.is_file() or entry.suffix.lower() != NOTE_EXT:
                            continue
                        try:
                            content = entry.read_text(encoding="utf-8")
                        except OSError:
                            continue
                        rows.append(
                            {
                                "rel_path": self._rel(entry),
                                "project_slug": project_dir.name,
                                "project_name": meta["name"],
                                "title": entry.stem,
                                "content": content,
                                "created_at": _file_created_ms(entry),
                                "updated_at": _file_updated_ms(entry),
                            }
                        )
            with self._connect() as conn:
                db.replace_all_index(conn, rows)
            return len(rows)

    # ---------- Projects ----------

    def list_projects(self) -> list[dict]:
        with self._op_lock:
            self.projects_root.mkdir(parents=True, exist_ok=True)
            projects: list[dict] = []
            for entry in self.projects_root.iterdir():
                if not entry.is_dir():
                    continue
                meta = self._read_project_meta(entry)
                notes_dir = entry / NOTES_SUBDIR
                notes_dir.mkdir(parents=True, exist_ok=True)
                notes: list[dict] = []
                for note_entry in notes_dir.iterdir():
                    if not note_entry.is_file() or note_entry.suffix.lower() != NOTE_EXT:
                        continue
                    notes.append(
                        {
                            "name": note_entry.stem,
                            "path": self._rel(note_entry),
                            "projectSlug": entry.name,
                            "createdAt": _file_created_ms(note_entry),
                            "updatedAt": _file_updated_ms(note_entry),
                        }
                    )
                notes.sort(key=lambda item: item["createdAt"], reverse=True)
                projects.append(
                    {
                        "slug": entry.name,
                        "name": meta["name"],
                        "path": self._rel(entry),
                        "createdAt": meta["createdAt"],
                        "repoPath": meta.get("repoPath"),
                        "glossary": meta.get("glossary", []),
                        "notes": notes,
                    }
                )

            # Inbox stays pinned on top, then alphabetical (case-insensitive)
            projects.sort(
                key=lambda p: (
                    0 if p["slug"].lower() == DEFAULT_PROJECT_SLUG.lower() else 1,
                    p["name"].lower(),
                )
            )
            return projects

    def create_project(
        self, name: str, *, repo_path: str | None = None, glossary: list[str] | None = None
    ) -> dict:
        with self._op_lock:
            meta = self._create_project_unlocked(name, repo_path=repo_path, glossary=glossary)
            project_dir = self.projects_root / meta["slug"]
            return {
                "slug": meta["slug"],
                "name": meta["name"],
                "path": self._rel(project_dir),
                "createdAt": meta["createdAt"],
                "repoPath": meta.get("repoPath"),
                "glossary": meta.get("glossary", []),
                "notes": [],
            }

    def update_project(
        self,
        slug: str,
        *,
        name: str | None = None,
        repo_path: str | None = None,
        glossary: list[str] | None = None,
    ) -> dict:
        with self._op_lock:
            project_dir = self._project_dir(slug)
            if not project_dir.is_dir():
                raise FileNotFoundError(f"Project not found: {slug}")
            meta = self._read_project_meta(project_dir)

            target_dir = project_dir
            if name is not None and name.strip():
                next_slug = sanitize_name(name, project_dir.name)
                if next_slug != project_dir.name:
                    candidate = self.projects_root / next_slug
                    if candidate.exists():
                        raise FileExistsError("มีโปรเจคชื่อนี้อยู่แล้ว")
                    project_dir.rename(candidate)
                    target_dir = candidate
                    meta["slug"] = next_slug
                meta["name"] = name.strip()

            if repo_path is not None:
                meta["repoPath"] = repo_path.strip() or None
            if glossary is not None:
                meta["glossary"] = [g.strip() for g in glossary if g.strip()]

            self._write_project_meta(target_dir, meta)
            self.rebuild_index()
            for proj in self.list_projects():
                if proj["slug"] == target_dir.name:
                    return proj
            raise FileNotFoundError(target_dir.name)

    def delete_project(self, slug: str) -> None:
        with self._op_lock:
            project_dir = self._project_dir(slug)
            if not project_dir.is_dir():
                return
            shutil.rmtree(project_dir)
            with self._connect() as conn:
                db.delete_project_index(conn, slug)

    # ---------- Notes ----------

    def create_note(self, project_slug: str | None = None, title: str | None = None) -> dict:
        with self._op_lock:
            target_slug = sanitize_name(project_slug or DEFAULT_PROJECT_SLUG, DEFAULT_PROJECT_SLUG)
            project_dir = self.projects_root / target_slug
            if not project_dir.is_dir():
                self._create_project_unlocked(target_slug)
            notes_dir = project_dir / NOTES_SUBDIR
            notes_dir.mkdir(parents=True, exist_ok=True)
            note_file = self._unique_note_path(notes_dir, title or "new note")
            _atomic_write_text(note_file, "")
            with self._connect() as conn:
                self._index_note_file(conn, note_file)
            return {
                "name": note_file.stem,
                "path": self._rel(note_file),
                "projectSlug": project_dir.name,
                "createdAt": _file_created_ms(note_file),
                "updatedAt": _file_updated_ms(note_file),
            }

    def read_note(self, rel_path: str) -> dict:
        note_file = self.resolve_under_root(rel_path)
        self._note_project_dir(note_file)
        if not note_file.is_file():
            raise FileNotFoundError(rel_path)
        content = note_file.read_text(encoding="utf-8")
        return {
            "path": self._rel(note_file),
            "name": note_file.stem,
            "projectSlug": self._note_project_dir(note_file).name,
            "content": content,
            "createdAt": _file_created_ms(note_file),
            "updatedAt": _file_updated_ms(note_file),
        }

    def write_note(
        self,
        rel_path: str,
        content: str,
        *,
        must_exist: bool = True,
        history_interval_min: int = 5,
        history_keep: int = 30,
    ) -> dict:
        with self._op_lock:
            note_file = self.resolve_under_root(rel_path)
            self._note_project_dir(note_file)
            if must_exist and not note_file.is_file():
                # Ghost-file guard (fixes BUGFIX_NOTES P1): never recreate a renamed/deleted note
                return {"saved": False, "reason": "missing", "path": rel_path}

            if note_file.is_file():
                self._maybe_snapshot_before_write(
                    note_file,
                    interval_min=max(1, min(120, history_interval_min)),
                    keep=max(1, min(100, history_keep)),
                )

            _atomic_write_text(note_file, content)
            with self._connect() as conn:
                self._index_note_file(conn, note_file)
            return {
                "saved": True,
                "path": self._rel(note_file),
                "updatedAt": _file_updated_ms(note_file),
            }

    def rename_note(self, rel_path: str, new_title: str) -> dict:
        with self._op_lock:
            note_file = self.resolve_under_root(rel_path)
            project_dir = self._note_project_dir(note_file)
            if not note_file.is_file():
                raise FileNotFoundError(rel_path)

            old_stem = note_file.stem
            next_stem = sanitize_name(new_title, "untitled")
            if next_stem == old_stem:
                return {
                    "name": old_stem,
                    "path": self._rel(note_file),
                    "projectSlug": project_dir.name,
                    "createdAt": _file_created_ms(note_file),
                    "updatedAt": _file_updated_ms(note_file),
                }

            target = self._unique_note_path(note_file.parent, next_stem)
            old_rel = self._rel(note_file)
            note_file.rename(target)
            self._relocate_assets(note_file, target, old_stem, target.stem)
            self._relocate_history(note_file, target, old_stem, target.stem)
            self._last_snapshot_ms.pop(old_rel, None)

            with self._connect() as conn:
                db.delete_note_index(conn, old_rel)
                self._index_note_file(conn, target)

            return {
                "name": target.stem,
                "path": self._rel(target),
                "projectSlug": project_dir.name,
                "createdAt": _file_created_ms(target),
                "updatedAt": _file_updated_ms(target),
            }

    def move_note(self, rel_path: str, target_project_slug: str) -> dict:
        with self._op_lock:
            note_file = self.resolve_under_root(rel_path)
            self._note_project_dir(note_file)
            if not note_file.is_file():
                raise FileNotFoundError(rel_path)

            target_slug = sanitize_name(target_project_slug, DEFAULT_PROJECT_SLUG)
            target_project_dir = self.projects_root / target_slug
            if not target_project_dir.is_dir():
                self._create_project_unlocked(target_slug)
            target_notes_dir = target_project_dir / NOTES_SUBDIR
            target_notes_dir.mkdir(parents=True, exist_ok=True)

            old_stem = note_file.stem
            old_rel = self._rel(note_file)
            target = self._unique_note_path(target_notes_dir, old_stem)
            shutil.move(str(note_file), str(target))
            self._relocate_assets(note_file, target, old_stem, target.stem)
            self._relocate_history(note_file, target, old_stem, target.stem)
            self._last_snapshot_ms.pop(old_rel, None)

            with self._connect() as conn:
                db.delete_note_index(conn, old_rel)
                self._index_note_file(conn, target)

            return {
                "name": target.stem,
                "path": self._rel(target),
                "projectSlug": target_project_dir.name,
                "createdAt": _file_created_ms(target),
                "updatedAt": _file_updated_ms(target),
            }

    def delete_note(self, rel_path: str) -> None:
        with self._op_lock:
            note_file = self.resolve_under_root(rel_path)
            self._note_project_dir(note_file)
            old_rel = self._rel(note_file)
            if note_file.is_file():
                note_file.unlink()
            self._last_snapshot_ms.pop(old_rel, None)
            with self._connect() as conn:
                db.delete_note_index(conn, old_rel)

    # ---------- Assets & History helpers ----------

    def _relocate_assets(
        self, source_note: Path, target_note: Path, old_stem: str, next_stem: str
    ) -> None:
        old_assets_name = f"{old_stem}.assets"
        next_assets_name = f"{next_stem}.assets"
        old_assets = source_note.parent / old_assets_name
        next_assets = target_note.parent / next_assets_name
        if old_assets == next_assets or not old_assets.is_dir() or next_assets.exists():
            return
        shutil.move(str(old_assets), str(next_assets))
        if old_assets_name != next_assets_name and target_note.is_file():
            content = target_note.read_text(encoding="utf-8")
            encoded_next = next_assets_name.replace(" ", "%20")
            updated = (
                content.replace(urllib.parse.quote(old_assets_name), encoded_next)
                .replace(old_assets_name.replace(" ", "%20"), encoded_next)
                .replace(old_assets_name, encoded_next)
            )
            if updated != content:
                _atomic_write_text(target_note, updated)

    def _history_dir(self, note_file: Path) -> Path:
        return note_file.parent / HISTORY_DIR / note_file.stem

    def _relocate_history(
        self, source_note: Path, target_note: Path, old_stem: str, next_stem: str
    ) -> None:
        old_dir = source_note.parent / HISTORY_DIR / old_stem
        next_parent = target_note.parent / HISTORY_DIR
        next_dir = next_parent / next_stem
        if old_dir == next_dir or not old_dir.is_dir() or next_dir.exists():
            return
        next_parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_dir), str(next_dir))

    def _snapshot_filename(self, now: datetime | None = None) -> str:
        dt = now or datetime.now()
        return dt.strftime("%Y-%m-%d %H-%M-%S") + NOTE_EXT

    def _snapshot_time_ms(self, filename: str) -> int | None:
        match = SNAPSHOT_NAME_RE.match(filename)
        if not match:
            return None
        y, mo, d, h, mi, s = (int(part) for part in match.groups())
        return int(datetime(y, mo, d, h, mi, s).timestamp() * 1000)

    def list_snapshots(self, note_rel_path: str) -> list[dict]:
        note_file = self.resolve_under_root(note_rel_path)
        self._note_project_dir(note_file)
        hist_dir = self._history_dir(note_file)
        if not hist_dir.is_dir():
            return []
        items: list[dict] = []
        for entry in hist_dir.iterdir():
            if not entry.is_file():
                continue
            saved_at = self._snapshot_time_ms(entry.name)
            if saved_at is None:
                continue
            items.append({"path": self._rel(entry), "savedAt": saved_at})
        items.sort(key=lambda item: item["savedAt"], reverse=True)
        return items

    def read_snapshot(self, snapshot_rel_path: str) -> str:
        snap_file = self.resolve_under_root(snapshot_rel_path)
        if HISTORY_DIR not in snap_file.parts or not snap_file.is_file():
            raise FileNotFoundError(snapshot_rel_path)
        return snap_file.read_text(encoding="utf-8")

    def save_snapshot(self, note_rel_path: str, content: str, *, keep: int = 30) -> dict | None:
        if not content.strip():
            return None
        with self._op_lock:
            note_file = self.resolve_under_root(note_rel_path)
            self._note_project_dir(note_file)
            hist_dir = self._history_dir(note_file)
            hist_dir.mkdir(parents=True, exist_ok=True)
            target = hist_dir / self._snapshot_filename()
            _atomic_write_text(target, content)
            self._last_snapshot_ms[self._rel(note_file)] = _now_ms()
            snapshots = self.list_snapshots(note_rel_path)
            for stale in snapshots[max(1, keep) :]:
                try:
                    self.resolve_under_root(stale["path"]).unlink()
                except OSError:
                    pass
            return {"path": self._rel(target), "savedAt": _now_ms()}

    def _maybe_snapshot_before_write(
        self, note_file: Path, *, interval_min: int, keep: int
    ) -> None:
        rel = self._rel(note_file)
        now = _now_ms()
        last = self._last_snapshot_ms.get(rel, 0)
        if now - last < interval_min * 60 * 1000:
            return
        self._last_snapshot_ms[rel] = now
        try:
            current = note_file.read_text(encoding="utf-8")
        except OSError:
            return
        if not current.strip():
            return
        existing = self.list_snapshots(rel)
        if existing:
            try:
                if self.read_snapshot(existing[0]["path"]) == current:
                    return
            except OSError:
                pass
        self.save_snapshot(rel, current, keep=keep)

    def save_image_asset(
        self, note_rel_path: str, filename: str, content_type: str | None, data: bytes
    ) -> str:
        with self._op_lock:
            note_file = self.resolve_under_root(note_rel_path)
            self._note_project_dir(note_file)
            assets_name = f"{note_file.stem}.assets"
            assets_dir = note_file.parent / assets_name
            assets_dir.mkdir(parents=True, exist_ok=True)

            ext_match = re.search(r"\.([a-z0-9]{1,8})$", filename or "", re.IGNORECASE)
            ext = (
                ext_match.group(1).lower()
                if ext_match
                else MIME_TO_EXT.get((content_type or "").lower(), "png")
            )
            image_name = f"image-{_now_ms()}-{uuid.uuid4().hex[:6]}.{ext}"
            _atomic_write_bytes(assets_dir / image_name, data)
            return f"{assets_name.replace(' ', '%20')}/{image_name}"

    def resolve_asset_file(self, note_rel_path: str, asset_rel: str) -> Path:
        note_file = self.resolve_under_root(note_rel_path)
        self._note_project_dir(note_file)
        decoded = urllib.parse.unquote(asset_rel).replace("\\", "/")
        candidate = (note_file.parent / decoded).resolve()
        candidate.relative_to(note_file.parent.resolve())
        if not candidate.is_file():
            raise FileNotFoundError(asset_rel)
        return candidate

    def inline_note_images(self, note_rel_path: str, content: str) -> str:
        note_file = self.resolve_under_root(note_rel_path)
        self._note_project_dir(note_file)

        def replace_match(match: re.Match[str]) -> str:
            alt, raw_path, title = match.group(1), match.group(2), match.group(3) or ""
            if HAS_SCHEME_OR_ABS.match(raw_path):
                return match.group(0)
            try:
                asset_path = self.resolve_asset_file(note_rel_path, raw_path)
                data = asset_path.read_bytes()
            except (ValueError, OSError):
                return match.group(0)
            ext = asset_path.suffix.lstrip(".").lower()
            mime = EXT_TO_MIME.get(ext) or mimetypes.guess_type(asset_path.name)[0] or "image/png"
            b64 = base64.b64encode(data).decode("ascii")
            return f"![{alt}](data:{mime};base64,{b64}{title})"

        return INLINE_IMAGE_RE.sub(replace_match, content)

    # ---------- Search & Session ----------

    def search(self, query: str, *, project_slug: str | None = None, limit: int = 30) -> list[dict]:
        with self._connect() as conn:
            return db.search_notes(conn, query, project_slug=project_slug, limit=limit)

    def load_session(self) -> dict | None:
        if not self.session_file.is_file():
            return None
        try:
            data = json.loads(self.session_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def save_session(self, payload: dict) -> dict:
        with self._op_lock:
            _atomic_write_text(self.session_file, json.dumps(payload, ensure_ascii=False))
            return {"saved": True, "updatedAt": _now_ms()}

    # ---------- Legacy PlainMark import (non-destructive copy) ----------

    def import_legacy_folder(self, source_dir: Path) -> dict:
        """Copy old PlainMark group folders (Documents\\PlainMark) into projects safely."""
        src = source_dir.expanduser().resolve()
        if not src.is_dir():
            raise FileNotFoundError(str(src))
        imported_projects = 0
        imported_notes = 0
        with self._op_lock:
            for group_entry in src.iterdir():
                if not group_entry.is_dir() or group_entry.name.startswith("."):
                    continue
                md_files = [
                    f
                    for f in group_entry.iterdir()
                    if f.is_file() and f.suffix.lower() == NOTE_EXT
                ]
                if not md_files:
                    continue
                slug = sanitize_name(group_entry.name, "Imported")
                project_dir = self.projects_root / slug
                if not project_dir.is_dir():
                    self._create_project_unlocked(group_entry.name)
                    imported_projects += 1
                notes_dir = project_dir / NOTES_SUBDIR
                notes_dir.mkdir(parents=True, exist_ok=True)
                for md in md_files:
                    dest = notes_dir / md.name
                    if dest.exists():
                        continue
                    shutil.copy2(md, dest)
                    imported_notes += 1
                    src_assets = group_entry / f"{md.stem}.assets"
                    dest_assets = notes_dir / f"{md.stem}.assets"
                    if src_assets.is_dir() and not dest_assets.exists():
                        shutil.copytree(src_assets, dest_assets)
            self.rebuild_index()
        return {
            "importedProjects": imported_projects,
            "importedNotes": imported_notes,
            "source": str(src),
        }
