"""Filesystem-first workspace storage with SQLite FTS5 mirror and atomic writes."""

from __future__ import annotations

import base64
import hashlib
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

from . import db, privacy

NOTE_EXT = ".md"
HISTORY_DIR = ".history"
PROJECTS_DIR = "projects"
GENERAL_DIR = "general"
SCRATCH_DIR = "scratch"
SHARED_DIR = "shared"
NOTES_SUBDIR = "notes"
MEETINGS_SUBDIR = "meetings"
KNOWLEDGE_SUBDIR = "knowledge"
VOICEPRINTS_SUBDIR = "voiceprints"
RESERVED_MEETING_DIRS = {"inbox", "broken"}
DEFAULT_PROJECT_SLUG = "Inbox"
PROMPT_VERSION = "v1.5a"

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

DEFAULT_SETTINGS = {
    "appearance": {
        "themeMode": "system",
        "accentColor": "indigo",
        "fontFamily": "sarabun",
        "fontSize": 15,
    },
    "aiDefaults": {
        "insights": {"provider": "lms", "model": "", "effort": "medium"},
        "meetings": {"provider": "lms", "model": "", "effort": "medium"},
        "knowledge": {"provider": "lms", "model": "", "effort": "medium"},
        "assistant": {"provider": "lms", "model": "", "effort": "medium"},
    },
    "backup": {
        "enabled": True,
        "destination": "",
        "keepDaily": 7,
        "keepWeekly": 4,
    },
    "privacy": {
        "defaultMeetingVisibility": "local_only",
        "redactPiiOnCloud": True,
    },
}

DEFAULT_BOARD = {
    "mode": "columns",
    "columns": [
        {"id": "todo", "title": "ต้องทำต่อ"},
        {"id": "doing", "title": "กำลังทำ"},
        {"id": "pin", "title": "แปะกันลืม"},
    ],
    "cards": [],
    "customColors": [],
}

CLI_CANDIDATES = {
    "claude": {"label": "Claude Code", "type": "cloud"},
    "grok": {"label": "Grok CLI", "type": "cloud"},
    "codex": {"label": "Codex CLI", "type": "cloud"},
    "gemini": {"label": "Gemini CLI", "type": "cloud"},
    "opencode": {"label": "OpenCode", "type": "cloud"},
    "lms": {"label": "LM Studio", "type": "local"},
}


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


def _atomic_write_json(target: Path, data: object) -> None:
    _atomic_write_text(target, json.dumps(data, ensure_ascii=False, indent=2))


def _read_json(path: Path, default):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return default


def _deep_merge(base: dict, patch: dict) -> dict:
    merged = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = _deep_merge(merged[k], v)
        else:
            merged[k] = v
    return merged


class WorkspaceStorage:
    """Manages projects, general, scratch, notes, meetings, knowledge, and search index."""

    def __init__(self, data_root: Path) -> None:
        self.root = data_root.resolve()
        self.projects_root = self.root / PROJECTS_DIR
        self.general_root = self.root / GENERAL_DIR
        self.scratch_root = self.root / SCRATCH_DIR
        self.shared_root = self.root / SHARED_DIR
        self.voiceprints_root = self.shared_root / VOICEPRINTS_SUBDIR
        self.contacts_file = self.shared_root / "contacts.json"
        self.settings_file = self.root / "settings.json"
        self.closed_log_file = self.root / "closed_log.json"
        self.cli_cache_file = self.root / "cli_models_cache.json"
        self.session_file = self.root / "session.json"
        self.db_path = self.root / "plainmark.sqlite"
        self._op_lock = threading.RLock()
        self._last_snapshot_ms: dict[str, int] = {}
        self.ensure_initialized()

    def ensure_initialized(self) -> None:
        with self._op_lock:
            self.projects_root.mkdir(parents=True, exist_ok=True)
            self.scratch_root.mkdir(parents=True, exist_ok=True)
            self.voiceprints_root.mkdir(parents=True, exist_ok=True)
            for sub in (
                NOTES_SUBDIR,
                MEETINGS_SUBDIR,
                f"{MEETINGS_SUBDIR}/inbox",
                f"{MEETINGS_SUBDIR}/broken",
                KNOWLEDGE_SUBDIR,
            ):
                (self.general_root / sub).mkdir(parents=True, exist_ok=True)
            if not any(p.is_dir() for p in self.projects_root.iterdir()):
                self._create_project_unlocked(DEFAULT_PROJECT_SLUG)
            self._backup_legacy_inbox_to_scratch()
            self.rebuild_index()

    def _backup_legacy_inbox_to_scratch(self) -> int:
        """Copy legacy projects/Inbox/notes/*.md to scratch/inbox-backup-*.md (idempotent)."""
        inbox_notes = self.projects_root / DEFAULT_PROJECT_SLUG / NOTES_SUBDIR
        if not inbox_notes.is_dir():
            return 0
        copied = 0
        for entry in inbox_notes.iterdir():
            if not entry.is_file() or entry.suffix.lower() != NOTE_EXT:
                continue
            backup_target = self.scratch_root / f"inbox-backup-{entry.stem}{NOTE_EXT}"
            if backup_target.exists():
                continue
            shutil.copy2(entry, backup_target)
            copied += 1
        return copied

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

    def _normalize_scope(self, scope: str | None) -> str:
        if not scope or scope.strip() in {"general", "_general"}:
            return "general"
        cleaned = scope.strip()
        if cleaned.startswith("project:"):
            slug = cleaned[len("project:") :].strip()
            safe = sanitize_name(slug, "")
            if not safe or safe != slug:
                raise ValueError("Invalid project scope")
            return f"project:{safe}"
        safe = sanitize_name(cleaned, "")
        if not safe or safe != cleaned:
            raise ValueError("Invalid scope")
        return f"project:{safe}"

    def _scope_dir(self, scope: str) -> Path:
        norm = self._normalize_scope(scope)
        if norm == "general":
            return self.general_root
        slug = norm[len("project:") :]
        return self._project_dir(slug)

    def _ensure_scope_subdirs(self, scope_dir: Path) -> None:
        for sub in (NOTES_SUBDIR, MEETINGS_SUBDIR, KNOWLEDGE_SUBDIR):
            (scope_dir / sub).mkdir(parents=True, exist_ok=True)

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
            "hidden": False,
            "defaultVisibility": "local_only",
        }
        loaded = _read_json(meta_path, None)
        if isinstance(loaded, dict):
            base.update(
                {
                    "name": str(loaded.get("name") or slug),
                    "createdAt": int(loaded.get("createdAt") or base["createdAt"]),
                    "repoPath": loaded.get("repoPath") or None,
                    "glossary": list(loaded.get("glossary") or []),
                    "hidden": bool(loaded.get("hidden", False)),
                    "defaultVisibility": privacy.normalize_visibility(
                        loaded.get("defaultVisibility")
                    ),
                }
            )
        return base

    def _write_project_meta(self, project_dir: Path, meta: dict) -> None:
        _atomic_write_json(self._project_meta_path(project_dir), meta)

    def _create_project_unlocked(
        self,
        name: str,
        *,
        repo_path: str | None = None,
        glossary: list[str] | None = None,
        hidden: bool = False,
        default_visibility: str | None = None,
    ) -> dict:
        slug = sanitize_name(name, "Project")
        project_dir = self.projects_root / slug
        self._ensure_scope_subdirs(project_dir)
        meta = self._read_project_meta(project_dir)
        meta["slug"] = slug
        meta["name"] = name.strip() or slug
        if repo_path is not None:
            meta["repoPath"] = repo_path.strip() or None
        if glossary is not None:
            meta["glossary"] = [g.strip() for g in glossary if g.strip()]
        meta["hidden"] = bool(hidden)
        if default_visibility is not None:
            meta["defaultVisibility"] = privacy.normalize_visibility(default_visibility)
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

    def _note_scope_info(self, note_file: Path) -> tuple[str, str, str, bool, list[str]]:
        resolved = note_file.resolve()
        try:
            rel_gen = resolved.relative_to(self.general_root.resolve()).parts
            if len(rel_gen) == 2 and rel_gen[0] == NOTES_SUBDIR:
                return ("general", "_general", "ทั่วไป", False, [])
        except ValueError:
            pass

        try:
            rel_proj = resolved.relative_to(self.projects_root.resolve()).parts
            if len(rel_proj) == 3 and rel_proj[1] == NOTES_SUBDIR:
                project_dir = self.projects_root / rel_proj[0]
                meta = self._read_project_meta(project_dir)
                return (
                    f"project:{project_dir.name}",
                    project_dir.name,
                    meta["name"],
                    bool(meta.get("hidden", False)),
                    list(meta.get("glossary") or []),
                )
        except ValueError:
            pass
        raise ValueError("Path is not a workspace note")

    def _index_note_file(self, conn, note_file: Path) -> None:
        if not note_file.is_file():
            return
        scope, project_slug, project_name, hidden, glossary = self._note_scope_info(note_file)
        try:
            content = note_file.read_text(encoding="utf-8")
        except OSError:
            return
        db.upsert_note(
            conn,
            rel_path=self._rel(note_file),
            scope=scope,
            project_slug=project_slug,
            project_name=project_name,
            hidden=hidden,
            title=note_file.stem,
            content=content,
            created_at=_file_created_ms(note_file),
            updated_at=_file_updated_ms(note_file),
            user_words=glossary,
        )

    def _collect_note_rows_from_disk(self) -> list[dict]:
        rows: list[dict] = []
        general_notes = self.general_root / NOTES_SUBDIR
        if general_notes.is_dir():
            for entry in general_notes.iterdir():
                if not entry.is_file() or entry.suffix.lower() != NOTE_EXT:
                    continue
                try:
                    content = entry.read_text(encoding="utf-8")
                except OSError:
                    continue
                rows.append(
                    {
                        "rel_path": self._rel(entry),
                        "scope": "general",
                        "project_slug": "_general",
                        "project_name": "ทั่วไป",
                        "hidden": False,
                        "title": entry.stem,
                        "content": content,
                        "created_at": _file_created_ms(entry),
                        "updated_at": _file_updated_ms(entry),
                        "user_words": [],
                    }
                )
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
                            "scope": f"project:{project_dir.name}",
                            "project_slug": project_dir.name,
                            "project_name": meta["name"],
                            "hidden": bool(meta.get("hidden", False)),
                            "title": entry.stem,
                            "content": content,
                            "created_at": _file_created_ms(entry),
                            "updated_at": _file_updated_ms(entry),
                            "user_words": list(meta.get("glossary") or []),
                        }
                    )
        return rows

    def rebuild_index(self) -> int:
        with self._op_lock:
            rows = self._collect_note_rows_from_disk()
            with self._connect() as conn:
                db.replace_all_index(conn, rows)
            return len(rows)

    def rebuild_index_from_disk(self) -> int:
        with self._op_lock:
            rows = self._collect_note_rows_from_disk()
            return db.rebuild_index_from_disk(self.db_path, rows)

    # ---------- Projects ----------

    def list_projects(self, *, include_hidden: bool = True) -> list[dict]:
        with self._op_lock:
            self.projects_root.mkdir(parents=True, exist_ok=True)
            projects: list[dict] = []
            for entry in self.projects_root.iterdir():
                if not entry.is_dir():
                    continue
                meta = self._read_project_meta(entry)
                if not include_hidden and meta.get("hidden"):
                    continue
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
                            "scope": f"project:{entry.name}",
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
                        "hidden": bool(meta.get("hidden", False)),
                        "defaultVisibility": meta.get("defaultVisibility", "local_only"),
                        "notes": notes,
                    }
                )

            projects.sort(
                key=lambda p: (
                    0 if p["slug"].lower() == DEFAULT_PROJECT_SLUG.lower() else 1,
                    p["name"].lower(),
                )
            )
            return projects

    def create_project(
        self,
        name: str,
        *,
        repo_path: str | None = None,
        glossary: list[str] | None = None,
        hidden: bool = False,
        default_visibility: str | None = None,
    ) -> dict:
        with self._op_lock:
            meta = self._create_project_unlocked(
                name,
                repo_path=repo_path,
                glossary=glossary,
                hidden=hidden,
                default_visibility=default_visibility,
            )
            project_dir = self.projects_root / meta["slug"]
            return {
                "slug": meta["slug"],
                "name": meta["name"],
                "path": self._rel(project_dir),
                "createdAt": meta["createdAt"],
                "repoPath": meta.get("repoPath"),
                "glossary": meta.get("glossary", []),
                "hidden": bool(meta.get("hidden", False)),
                "defaultVisibility": meta.get("defaultVisibility", "local_only"),
                "notes": [],
            }

    def update_project(
        self,
        slug: str,
        *,
        name: str | None = None,
        repo_path: str | None = None,
        glossary: list[str] | None = None,
        hidden: bool | None = None,
        default_visibility: str | None = None,
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
            if hidden is not None:
                meta["hidden"] = bool(hidden)
            if default_visibility is not None:
                meta["defaultVisibility"] = privacy.normalize_visibility(default_visibility)

            self._write_project_meta(target_dir, meta)
            self.rebuild_index()
            for proj in self.list_projects(include_hidden=True):
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

    def _list_scope_dirs(
        self, scope: str, *, include_hidden: bool = False
    ) -> list[tuple[str, Path]]:
        if scope == "all":
            targets: list[tuple[str, Path]] = [("general", self.general_root)]
            if self.projects_root.is_dir():
                for proj in sorted(self.projects_root.iterdir(), key=lambda p: p.name.lower()):
                    if not proj.is_dir():
                        continue
                    meta = self._read_project_meta(proj)
                    if not include_hidden and meta.get("hidden"):
                        continue
                    targets.append((f"project:{proj.name}", proj))
            return targets
        norm = self._normalize_scope(scope)
        sdir = self._scope_dir(norm)
        if not sdir.is_dir():
            return []
        return [(norm, sdir)]

    def list_notes(self, scope: str = "all", *, include_hidden: bool = False) -> list[dict]:
        with self._op_lock:
            items: list[dict] = []
            for sc, sdir in self._list_scope_dirs(scope, include_hidden=include_hidden):
                notes_dir = sdir / NOTES_SUBDIR
                if not notes_dir.is_dir():
                    continue
                slug = "_general" if sc == "general" else sdir.name
                for note_entry in notes_dir.iterdir():
                    if not note_entry.is_file() or note_entry.suffix.lower() != NOTE_EXT:
                        continue
                    items.append(
                        {
                            "name": note_entry.stem,
                            "path": self._rel(note_entry),
                            "scope": sc,
                            "projectSlug": slug,
                            "createdAt": _file_created_ms(note_entry),
                            "updatedAt": _file_updated_ms(note_entry),
                        }
                    )
            items.sort(key=lambda item: item["updatedAt"], reverse=True)
            return items

    def create_note(
        self,
        project_slug: str | None = None,
        title: str | None = None,
        *,
        scope: str | None = None,
    ) -> dict:
        with self._op_lock:
            if scope == "general" or project_slug == "_general":
                notes_dir = self.general_root / NOTES_SUBDIR
                notes_dir.mkdir(parents=True, exist_ok=True)
                out_scope = "general"
                out_slug = "_general"
            else:
                if scope and scope.startswith("project:"):
                    raw_slug = scope[len("project:") :]
                else:
                    raw_slug = project_slug or DEFAULT_PROJECT_SLUG
                target_slug = sanitize_name(raw_slug, DEFAULT_PROJECT_SLUG)
                project_dir = self.projects_root / target_slug
                if not project_dir.is_dir():
                    self._create_project_unlocked(target_slug)
                notes_dir = project_dir / NOTES_SUBDIR
                notes_dir.mkdir(parents=True, exist_ok=True)
                out_scope = f"project:{project_dir.name}"
                out_slug = project_dir.name

            note_file = self._unique_note_path(notes_dir, title or "new note")
            _atomic_write_text(note_file, "")
            with self._connect() as conn:
                self._index_note_file(conn, note_file)
            return {
                "name": note_file.stem,
                "path": self._rel(note_file),
                "scope": out_scope,
                "projectSlug": out_slug,
                "createdAt": _file_created_ms(note_file),
                "updatedAt": _file_updated_ms(note_file),
            }

    def read_note(self, rel_path: str) -> dict:
        note_file = self.resolve_under_root(rel_path)
        scope, slug, _, _, _ = self._note_scope_info(note_file)
        if not note_file.is_file():
            raise FileNotFoundError(rel_path)
        content = note_file.read_text(encoding="utf-8")
        return {
            "path": self._rel(note_file),
            "name": note_file.stem,
            "scope": scope,
            "projectSlug": slug,
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
            self._note_scope_info(note_file)
            if must_exist and not note_file.is_file():
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
            scope, slug, _, _, _ = self._note_scope_info(note_file)
            if not note_file.is_file():
                raise FileNotFoundError(rel_path)

            old_stem = note_file.stem
            next_stem = sanitize_name(new_title, "untitled")
            if next_stem == old_stem:
                return {
                    "name": old_stem,
                    "path": self._rel(note_file),
                    "scope": scope,
                    "projectSlug": slug,
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
                "scope": scope,
                "projectSlug": slug,
                "createdAt": _file_created_ms(target),
                "updatedAt": _file_updated_ms(target),
            }

    def move_note(
        self,
        rel_path: str,
        target_project_slug: str | None = None,
        *,
        target_scope: str | None = None,
    ) -> dict:
        with self._op_lock:
            note_file = self.resolve_under_root(rel_path)
            self._note_scope_info(note_file)
            if not note_file.is_file():
                raise FileNotFoundError(rel_path)

            if target_scope == "general" or target_project_slug == "_general":
                target_notes_dir = self.general_root / NOTES_SUBDIR
                target_notes_dir.mkdir(parents=True, exist_ok=True)
                out_scope = "general"
                out_slug = "_general"
            else:
                if target_scope and target_scope.startswith("project:"):
                    raw_slug = target_scope[len("project:") :]
                else:
                    raw_slug = target_project_slug or DEFAULT_PROJECT_SLUG
                target_slug = sanitize_name(raw_slug, DEFAULT_PROJECT_SLUG)
                target_project_dir = self.projects_root / target_slug
                if not target_project_dir.is_dir():
                    self._create_project_unlocked(target_slug)
                target_notes_dir = target_project_dir / NOTES_SUBDIR
                target_notes_dir.mkdir(parents=True, exist_ok=True)
                out_scope = f"project:{target_project_dir.name}"
                out_slug = target_project_dir.name

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
                "scope": out_scope,
                "projectSlug": out_slug,
                "createdAt": _file_created_ms(target),
                "updatedAt": _file_updated_ms(target),
            }

    def delete_note(self, rel_path: str) -> None:
        with self._op_lock:
            note_file = self.resolve_under_root(rel_path)
            self._note_scope_info(note_file)
            old_rel = self._rel(note_file)
            if note_file.is_file():
                note_file.unlink()
            self._last_snapshot_ms.pop(old_rel, None)
            with self._connect() as conn:
                db.delete_note_index(conn, old_rel)

    # ---------- Scratches (excluded from source_hash & AI Insights) ----------

    def _scratch_file(self, scratch_id: str) -> Path:
        safe = sanitize_name(scratch_id, "")
        if not safe or safe != scratch_id.strip():
            raise ValueError("Invalid scratch id")
        return self.scratch_root / f"{safe}{NOTE_EXT}"

    def list_scratches(self) -> list[dict]:
        with self._op_lock:
            self.scratch_root.mkdir(parents=True, exist_ok=True)
            items: list[dict] = []
            for entry in self.scratch_root.iterdir():
                if not entry.is_file() or entry.suffix.lower() != NOTE_EXT:
                    continue
                items.append(
                    {
                        "id": entry.stem,
                        "title": entry.stem,
                        "path": self._rel(entry),
                        "createdAt": _file_created_ms(entry),
                        "updatedAt": _file_updated_ms(entry),
                    }
                )
            items.sort(key=lambda item: item["updatedAt"], reverse=True)
            return items

    def create_scratch(self, title: str | None = None, content: str = "") -> dict:
        with self._op_lock:
            self.scratch_root.mkdir(parents=True, exist_ok=True)
            stem = sanitize_name(title or f"scratch-{_now_ms()}", "scratch")
            target = self._unique_note_path(self.scratch_root, stem)
            _atomic_write_text(target, content)
            return {
                "id": target.stem,
                "title": target.stem,
                "path": self._rel(target),
                "content": content,
                "createdAt": _file_created_ms(target),
                "updatedAt": _file_updated_ms(target),
            }

    def read_scratch(self, scratch_id: str) -> dict:
        target = self._scratch_file(scratch_id)
        if not target.is_file():
            raise FileNotFoundError(scratch_id)
        return {
            "id": target.stem,
            "title": target.stem,
            "path": self._rel(target),
            "content": target.read_text(encoding="utf-8"),
            "createdAt": _file_created_ms(target),
            "updatedAt": _file_updated_ms(target),
        }

    def update_scratch(
        self, scratch_id: str, content: str, *, title: str | None = None
    ) -> dict:
        with self._op_lock:
            target = self._scratch_file(scratch_id)
            if not target.is_file():
                raise FileNotFoundError(scratch_id)
            _atomic_write_text(target, content)
            if title and title.strip():
                next_stem = sanitize_name(title, target.stem)
                if next_stem != target.stem:
                    renamed = self._unique_note_path(self.scratch_root, next_stem)
                    target.rename(renamed)
                    target = renamed
            return {
                "id": target.stem,
                "title": target.stem,
                "path": self._rel(target),
                "content": content,
                "createdAt": _file_created_ms(target),
                "updatedAt": _file_updated_ms(target),
            }

    def delete_scratch(self, scratch_id: str) -> None:
        with self._op_lock:
            target = self._scratch_file(scratch_id)
            if target.is_file():
                target.unlink()

    def promote_scratch(
        self,
        scratch_id: str,
        *,
        target_scope: str = "general",
        title: str | None = None,
        keep_scratch: bool = False,
    ) -> dict:
        with self._op_lock:
            scratch = self.read_scratch(scratch_id)
            note = self.create_note(
                title=title or scratch["title"],
                scope=self._normalize_scope(target_scope),
            )
            self.write_note(note["path"], scratch["content"], must_exist=True)
            if not keep_scratch:
                self.delete_scratch(scratch_id)
            return {
                "note": self.read_note(note["path"]),
                "deletedScratch": not keep_scratch,
            }

    # ---------- Board & Closed Items ----------

    def _board_path(self, scope: str) -> Path:
        norm = self._normalize_scope(scope)
        sdir = self._scope_dir(norm)
        if norm != "general" and not sdir.is_dir():
            raise FileNotFoundError(f"Project not found: {norm}")
        return sdir / "board.json"

    def get_board(self, scope: str = "general") -> dict:
        path = self._board_path(scope)
        data = _read_json(path, None)
        if not isinstance(data, dict):
            return dict(DEFAULT_BOARD)
        return {
            "mode": data.get("mode", "columns"),
            "columns": list(data.get("columns") or DEFAULT_BOARD["columns"]),
            "cards": list(data.get("cards") or []),
            "customColors": list(data.get("customColors") or []),
        }

    def save_board(self, scope: str, payload: dict) -> dict:
        with self._op_lock:
            path = self._board_path(scope)
            board = {
                "mode": payload.get("mode", "columns"),
                "columns": list(payload.get("columns") or DEFAULT_BOARD["columns"]),
                "cards": list(payload.get("cards") or []),
                "customColors": list(payload.get("customColors") or []),
                "updatedAt": _now_ms(),
            }
            _atomic_write_json(path, board)
            return board

    def list_closed_items(self, scope: str | None = None) -> list[dict]:
        items = _read_json(self.closed_log_file, [])
        if not isinstance(items, list):
            return []
        if scope and scope != "all":
            norm = self._normalize_scope(scope)
            items = [i for i in items if i.get("scope") == norm]
        return sorted(items, key=lambda i: i.get("closedAt", 0), reverse=True)

    def record_closed_item(self, payload: dict) -> dict:
        with self._op_lock:
            items = _read_json(self.closed_log_file, [])
            if not isinstance(items, list):
                items = []
            entry = {
                "id": payload.get("id") or f"closed-{uuid.uuid4().hex[:8]}",
                "itemType": payload.get("itemType", "card"),
                "scope": self._normalize_scope(payload.get("scope", "general")),
                "title": payload.get("title", ""),
                "reason": payload.get("reason", "done"),
                "assignee": payload.get("assignee", ""),
                "note": payload.get("note", ""),
                "snapshot": payload.get("snapshot") or {},
                "closedAt": _now_ms(),
                "restored": False,
                "restoredAt": None,
            }
            items.append(entry)
            _atomic_write_json(self.closed_log_file, items)
            return entry

    def restore_closed_item(self, item_id: str) -> dict:
        with self._op_lock:
            items = _read_json(self.closed_log_file, [])
            if not isinstance(items, list):
                raise FileNotFoundError(item_id)
            target = next((i for i in items if i.get("id") == item_id), None)
            if target is None:
                raise FileNotFoundError(item_id)

            item_type = target.get("itemType", "card")
            scope = target.get("scope", "general")
            snap = target.get("snapshot") or {}
            restored_ref: dict = {}

            if item_type == "card":
                board = self.get_board(scope)
                card = dict(snap)
                if not card.get("id"):
                    card["id"] = f"card-{uuid.uuid4().hex[:8]}"
                board["cards"].append(card)
                self.save_board(scope, board)
                restored_ref = {"card": card}
            elif item_type == "note":
                created = self.create_note(
                    title=snap.get("title") or target.get("title") or "restored note",
                    scope=scope,
                )
                self.write_note(created["path"], snap.get("content", ""), must_exist=True)
                restored_ref = {"note": self.read_note(created["path"])}
            elif item_type == "scratch":
                created = self.create_scratch(
                    title=snap.get("title") or target.get("title") or "restored scratch",
                    content=snap.get("content", ""),
                )
                restored_ref = {"scratch": created}

            target["restored"] = True
            target["restoredAt"] = _now_ms()
            _atomic_write_json(self.closed_log_file, items)
            return {"item": target, "restored": restored_ref}

    # ---------- Settings & CLI Discovery ----------

    def get_settings(self) -> dict:
        loaded = _read_json(self.settings_file, {})
        if not isinstance(loaded, dict):
            loaded = {}
        return _deep_merge(DEFAULT_SETTINGS, loaded)

    def update_settings(self, patch: dict) -> dict:
        with self._op_lock:
            current = self.get_settings()
            updated = _deep_merge(current, patch)
            _atomic_write_json(self.settings_file, updated)
            return updated

    def discover_cli_models(self) -> dict:
        with self._op_lock:
            clis: dict[str, dict] = {}
            for name, meta in CLI_CANDIDATES.items():
                exe = shutil.which(name)
                clis[name] = {
                    "name": name,
                    "label": meta["label"],
                    "type": meta["type"],
                    "available": exe is not None,
                    "executable": exe,
                    "efforts": ["low", "medium", "high"],
                    "models": [],
                }
            payload = {
                "discoveredAt": _now_ms(),
                "clis": clis,
            }
            _atomic_write_json(self.cli_cache_file, payload)
            return payload

    def get_cli_models_cache(self) -> dict | None:
        data = _read_json(self.cli_cache_file, None)
        return data if isinstance(data, dict) else None

    # ---------- Meetings (with inbox/broken exclusion & .history/ snapshots) ----------

    def _find_meeting_dir(self, meeting_id: str) -> tuple[str, Path]:
        safe_id = sanitize_name(meeting_id, "")
        if not safe_id or safe_id != meeting_id.strip() or safe_id in RESERVED_MEETING_DIRS:
            raise ValueError("Invalid meeting id")
        for sc, sdir in self._list_scope_dirs("all", include_hidden=True):
            candidate = sdir / MEETINGS_SUBDIR / safe_id
            if candidate.is_dir() and (candidate / "meeting.json").is_file():
                return sc, candidate
        raise FileNotFoundError(f"Meeting not found: {meeting_id}")

    def _load_meeting_summary_record(self, scope: str, meeting_dir: Path) -> dict | None:
        meta = _read_json(meeting_dir / "meeting.json", None)
        if not isinstance(meta, dict):
            return None
        meta = dict(meta)
        meta["id"] = meta.get("id") or meeting_dir.name
        meta["scope"] = scope
        meta["visibility"] = privacy.normalize_visibility(meta.get("visibility"))
        return meta

    def list_meetings(
        self,
        *,
        scope: str = "all",
        limit: int = 50,
        offset: int = 0,
        q: str | None = None,
        include_hidden: bool = False,
    ) -> dict:
        with self._op_lock:
            records: list[dict] = []
            query_lower = (q or "").strip().lower()
            for sc, sdir in self._list_scope_dirs(scope, include_hidden=include_hidden):
                mdir = sdir / MEETINGS_SUBDIR
                if not mdir.is_dir():
                    continue
                for entry in mdir.iterdir():
                    if not entry.is_dir():
                        continue
                    if sc == "general" and entry.name.lower() in RESERVED_MEETING_DIRS:
                        continue
                    rec = self._load_meeting_summary_record(sc, entry)
                    if not rec:
                        continue
                    if query_lower:
                        haystack = " ".join(
                            [
                                str(rec.get("title", "")),
                                str(rec.get("summary", "")),
                                str(rec.get("date", "")),
                            ]
                        ).lower()
                        if query_lower not in haystack:
                            continue
                    records.append(rec)

            records.sort(
                key=lambda r: (
                    str(r.get("date") or ""),
                    str(r.get("startTime") or ""),
                    int(r.get("createdAt") or 0),
                ),
                reverse=True,
            )
            total = len(records)
            sliced = records[offset : offset + limit]
            inbox_items: list[dict] = []
            broken_items: list[dict] = []
            if scope in {"all", "general"}:
                for bucket_name, target_list in (
                    ("inbox", inbox_items),
                    ("broken", broken_items),
                ):
                    bdir = self.general_root / MEETINGS_SUBDIR / bucket_name
                    if not bdir.is_dir():
                        continue
                    for entry in sorted(bdir.iterdir(), key=lambda p: p.name):
                        if not entry.is_dir():
                            continue
                        rec = self._load_meeting_summary_record("general", entry)
                        if rec:
                            rec["bucket"] = bucket_name
                            target_list.append(rec)
            return {
                "items": sliced,
                "total": total,
                "limit": limit,
                "offset": offset,
                "inboxItems": inbox_items,
                "brokenItems": broken_items,
            }

    def create_meeting(self, payload: dict) -> dict:
        with self._op_lock:
            scope = self._normalize_scope(payload.get("scope", "general"))
            sdir = self._scope_dir(scope)
            if scope != "general" and not sdir.is_dir():
                self._create_project_unlocked(scope[len("project:") :])

            date_str = str(payload.get("date") or datetime.now().strftime("%Y-%m-%d"))
            start_time = str(payload.get("startTime") or "09:00")
            end_time = str(payload.get("endTime") or "")
            raw_title = str(payload.get("title") or "").strip()
            title = raw_title or f"ประชุม {date_str} {start_time}".strip()

            meeting_id = sanitize_name(
                payload.get("id") or f"mtg-{date_str}-{uuid.uuid4().hex[:6]}",
                f"mtg-{uuid.uuid4().hex[:6]}",
            )
            meeting_dir = sdir / MEETINGS_SUBDIR / meeting_id
            meeting_dir.mkdir(parents=True, exist_ok=True)
            now = _now_ms()

            meta = {
                "id": meeting_id,
                "scope": scope,
                "title": title,
                "date": date_str,
                "startTime": start_time,
                "endTime": end_time,
                "visibility": privacy.normalize_visibility(payload.get("visibility")),
                "participants": list(payload.get("participants") or []),
                "summary": str(payload.get("summary") or ""),
                "actionItems": list(payload.get("actionItems") or []),
                "keyframes": list(payload.get("keyframes") or []),
                "audioUrl": str(payload.get("audioUrl") or ""),
                "status": str(payload.get("status") or "ready"),
                "errorState": payload.get("errorState"),
                "provenance": payload.get("provenance"),
                "createdAt": now,
                "updatedAt": now,
            }
            transcript = {"segments": list(payload.get("segments") or [])}
            _atomic_write_json(meeting_dir / "meeting.json", meta)
            _atomic_write_json(meeting_dir / "transcript.json", transcript)
            return {**meta, "segments": transcript["segments"]}

    def get_meeting(self, meeting_id: str) -> dict:
        scope, mdir = self._find_meeting_dir(meeting_id)
        meta = self._load_meeting_summary_record(scope, mdir)
        if not meta:
            raise FileNotFoundError(meeting_id)
        transcript = _read_json(mdir / "transcript.json", {"segments": []})
        segments = transcript.get("segments", []) if isinstance(transcript, dict) else []
        return {**meta, "segments": segments}

    def update_meeting(self, meeting_id: str, patch: dict) -> dict:
        with self._op_lock:
            scope, mdir = self._find_meeting_dir(meeting_id)
            meta = self._load_meeting_summary_record(scope, mdir)
            if not meta:
                raise FileNotFoundError(meeting_id)
            for key in (
                "title",
                "date",
                "startTime",
                "endTime",
                "participants",
                "summary",
                "actionItems",
                "keyframes",
                "audioUrl",
                "status",
                "errorState",
                "provenance",
            ):
                if key in patch and patch[key] is not None:
                    meta[key] = patch[key]
            if "visibility" in patch and patch["visibility"] is not None:
                meta["visibility"] = privacy.normalize_visibility(patch["visibility"])
            meta["updatedAt"] = _now_ms()
            _atomic_write_json(mdir / "meeting.json", meta)
            return self.get_meeting(meeting_id)

    def delete_meeting(self, meeting_id: str) -> None:
        with self._op_lock:
            _, mdir = self._find_meeting_dir(meeting_id)
            shutil.rmtree(mdir)

    def move_meeting(self, meeting_id: str, target_scope: str) -> dict:
        with self._op_lock:
            old_scope, mdir = self._find_meeting_dir(meeting_id)
            norm_target = self._normalize_scope(target_scope)
            if old_scope == norm_target:
                return self.get_meeting(meeting_id)
            target_sdir = self._scope_dir(norm_target)
            if norm_target != "general" and not target_sdir.is_dir():
                self._create_project_unlocked(norm_target[len("project:") :])
            target_mdir = target_sdir / MEETINGS_SUBDIR / mdir.name
            target_mdir.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(mdir), str(target_mdir))
            meta = self._load_meeting_summary_record(norm_target, target_mdir)
            if meta:
                meta["scope"] = norm_target
                meta["updatedAt"] = _now_ms()
                _atomic_write_json(target_mdir / "meeting.json", meta)
            return self.get_meeting(meeting_id)

    def _snapshot_transcript_history(self, mdir: Path, reason: str) -> None:
        transcript_path = mdir / "transcript.json"
        if not transcript_path.is_file():
            return
        hist_dir = mdir / HISTORY_DIR
        hist_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        safe_reason = sanitize_name(reason, "edit")
        shutil.copy2(transcript_path, hist_dir / f"{stamp}-{safe_reason}.json")

    def update_meeting_transcript(
        self, meeting_id: str, segments: list[dict], *, reason: str = "edit"
    ) -> dict:
        with self._op_lock:
            scope, mdir = self._find_meeting_dir(meeting_id)
            self._snapshot_transcript_history(mdir, reason)
            _atomic_write_json(mdir / "transcript.json", {"segments": segments})
            meta = self._load_meeting_summary_record(scope, mdir)
            if meta:
                meta["updatedAt"] = _now_ms()
                _atomic_write_json(mdir / "meeting.json", meta)
            return self.get_meeting(meeting_id)

    def rename_meeting_speaker(
        self,
        meeting_id: str,
        old_speaker_id: str,
        new_name: str,
        *,
        new_speaker_id: str | None = None,
    ) -> dict:
        with self._op_lock:
            scope, mdir = self._find_meeting_dir(meeting_id)
            self._snapshot_transcript_history(mdir, "rename-speaker")
            transcript = _read_json(mdir / "transcript.json", {"segments": []})
            segments = transcript.get("segments", []) if isinstance(transcript, dict) else []
            updated_segments: list[dict] = []
            for seg in segments:
                s = dict(seg)
                if s.get("speakerId") == old_speaker_id or s.get("speaker") == old_speaker_id:
                    s["speakerName"] = new_name
                    s["speaker"] = new_name
                    if new_speaker_id:
                        s["speakerId"] = new_speaker_id
                updated_segments.append(s)
            _atomic_write_json(mdir / "transcript.json", {"segments": updated_segments})

            meta = self._load_meeting_summary_record(scope, mdir)
            if meta:
                participants = []
                for p in meta.get("participants", []):
                    p_copy = dict(p)
                    if p_copy.get("speakerId") == old_speaker_id:
                        p_copy["name"] = new_name
                        if new_speaker_id:
                            p_copy["speakerId"] = new_speaker_id
                    participants.append(p_copy)
                meta["participants"] = participants
                meta["updatedAt"] = _now_ms()
                _atomic_write_json(mdir / "meeting.json", meta)
            return self.get_meeting(meeting_id)

    def list_meeting_history(self, meeting_id: str) -> list[dict]:
        _, mdir = self._find_meeting_dir(meeting_id)
        hist_dir = mdir / HISTORY_DIR
        if not hist_dir.is_dir():
            return []
        items = [
            {
                "name": entry.name,
                "path": self._rel(entry),
                "savedAt": _file_updated_ms(entry),
            }
            for entry in hist_dir.iterdir()
            if entry.is_file() and entry.suffix.lower() == ".json"
        ]
        items.sort(key=lambda i: i["name"], reverse=True)
        return items

    # ---------- Voiceprints & Contacts ----------

    def list_voiceprints(self) -> list[dict]:
        with self._op_lock:
            self.voiceprints_root.mkdir(parents=True, exist_ok=True)
            items: list[dict] = []
            for entry in self.voiceprints_root.iterdir():
                if not entry.is_file() or entry.suffix.lower() != ".json":
                    continue
                data = _read_json(entry, None)
                if isinstance(data, dict):
                    items.append(data)
            items.sort(key=lambda v: str(v.get("name") or "").lower())
            return items

    def upsert_voiceprint(self, payload: dict, *, vp_id: str | None = None) -> dict:
        with self._op_lock:
            if "audio" in payload or "audioBytes" in payload or "wav" in payload:
                raise ValueError("Voiceprints store embeddings only; raw audio is forbidden")
            self.voiceprints_root.mkdir(parents=True, exist_ok=True)
            vid = sanitize_name(vp_id or payload.get("id") or f"vp-{uuid.uuid4().hex[:8]}", "vp")
            target = self.voiceprints_root / f"{vid}.json"
            existing = _read_json(target, {})
            if not isinstance(existing, dict):
                existing = {}
            now = _now_ms()
            record = {
                "id": vid,
                "name": payload.get("name", existing.get("name", "ไม่ทราบชื่อ")),
                "nickname": payload.get("nickname", existing.get("nickname", "")),
                "email": payload.get("email", existing.get("email", "")),
                "embedding": list(payload.get("embedding") or existing.get("embedding") or []),
                "projects": list(payload.get("projects") or existing.get("projects") or []),
                "createdAt": existing.get("createdAt", now),
                "updatedAt": now,
            }
            _atomic_write_json(target, record)
            return record

    def delete_voiceprint(self, vp_id: str) -> bool:
        """Forget Speaker: permanently remove voiceprint embedding file."""
        with self._op_lock:
            safe_id = sanitize_name(vp_id, "")
            if not safe_id or safe_id != vp_id.strip():
                raise ValueError("Invalid voiceprint id")
            target = self.voiceprints_root / f"{safe_id}.json"
            if not target.is_file():
                return False
            target.unlink()
            return True

    def list_contacts(self) -> list[dict]:
        data = _read_json(self.contacts_file, [])
        return data if isinstance(data, list) else []

    def upsert_contact(self, payload: dict) -> dict:
        with self._op_lock:
            contacts = self.list_contacts()
            cid = payload.get("id") or f"contact-{uuid.uuid4().hex[:8]}"
            now = _now_ms()
            updated = None
            for idx, item in enumerate(contacts):
                if item.get("id") == cid:
                    updated = {
                        **item,
                        "name": payload.get("name", item.get("name", "")),
                        "nickname": payload.get("nickname", item.get("nickname", "")),
                        "email": payload.get("email", item.get("email", "")),
                        "updatedAt": now,
                    }
                    contacts[idx] = updated
                    break
            if updated is None:
                updated = {
                    "id": cid,
                    "name": payload.get("name", ""),
                    "nickname": payload.get("nickname", ""),
                    "email": payload.get("email", ""),
                    "createdAt": now,
                    "updatedAt": now,
                }
                contacts.append(updated)
            _atomic_write_json(self.contacts_file, contacts)
            return updated

    def delete_contact(self, contact_id: str) -> bool:
        with self._op_lock:
            contacts = self.list_contacts()
            filtered = [c for c in contacts if c.get("id") != contact_id]
            if len(filtered) == len(contacts):
                return False
            _atomic_write_json(self.contacts_file, filtered)
            return True

    # ---------- Knowledge ----------

    def _find_knowledge_file(self, item_id: str) -> tuple[str, Path]:
        safe_id = sanitize_name(item_id, "")
        if not safe_id or safe_id != item_id.strip():
            raise ValueError("Invalid knowledge id")
        for sc, sdir in self._list_scope_dirs("all", include_hidden=True):
            candidate = sdir / KNOWLEDGE_SUBDIR / f"{safe_id}.json"
            if candidate.is_file():
                return sc, candidate
        raise FileNotFoundError(f"Knowledge item not found: {item_id}")

    def list_knowledge(
        self,
        *,
        scope: str = "all",
        read: bool | None = None,
        date: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        include_hidden: bool = False,
    ) -> list[dict]:
        with self._op_lock:
            items: list[dict] = []
            for sc, sdir in self._list_scope_dirs(scope, include_hidden=include_hidden):
                kdir = sdir / KNOWLEDGE_SUBDIR
                if not kdir.is_dir():
                    continue
                for entry in kdir.iterdir():
                    if not entry.is_file() or entry.suffix.lower() != ".json":
                        continue
                    data = _read_json(entry, None)
                    if not isinstance(data, dict):
                        continue
                    data = dict(data)
                    data["id"] = data.get("id") or entry.stem
                    data["scope"] = sc
                    if read is not None and bool(data.get("read", False)) != read:
                        continue
                    item_date = str(data.get("date") or "")
                    if date and item_date != date:
                        continue
                    if date_from and item_date < date_from:
                        continue
                    if date_to and item_date > date_to:
                        continue
                    items.append(data)
            items.sort(
                key=lambda k: (str(k.get("date") or ""), int(k.get("createdAt") or 0)),
                reverse=True,
            )
            return items

    def create_knowledge(self, payload: dict) -> dict:
        with self._op_lock:
            scope = self._normalize_scope(payload.get("scope", "general"))
            sdir = self._scope_dir(scope)
            if scope != "general" and not sdir.is_dir():
                self._create_project_unlocked(scope[len("project:") :])
            kdir = sdir / KNOWLEDGE_SUBDIR
            kdir.mkdir(parents=True, exist_ok=True)
            kid = sanitize_name(
                payload.get("id") or f"know-{uuid.uuid4().hex[:8]}",
                f"know-{uuid.uuid4().hex[:8]}",
            )
            now = _now_ms()
            record = {
                "id": kid,
                "scope": scope,
                "title": str(payload.get("title") or payload.get("url") or "Untitled"),
                "url": str(payload.get("url") or ""),
                "sourceType": str(payload.get("sourceType") or "web"),
                "reason": str(payload.get("reason") or ""),
                "summary": payload.get("summary") or "",
                "read": bool(payload.get("read", False)),
                "date": str(payload.get("date") or datetime.now().strftime("%Y-%m-%d")),
                "provenance": payload.get("provenance"),
                "createdAt": now,
                "updatedAt": now,
            }
            _atomic_write_json(kdir / f"{kid}.json", record)
            return record

    def update_knowledge(self, item_id: str, patch: dict) -> dict:
        with self._op_lock:
            sc, kfile = self._find_knowledge_file(item_id)
            data = _read_json(kfile, {})
            if not isinstance(data, dict):
                raise FileNotFoundError(item_id)
            for key in (
                "title",
                "url",
                "sourceType",
                "reason",
                "summary",
                "read",
                "date",
                "provenance",
            ):
                if key in patch and patch[key] is not None:
                    data[key] = patch[key]
            data["scope"] = sc
            data["updatedAt"] = _now_ms()
            _atomic_write_json(kfile, data)
            return data

    def delete_knowledge(self, item_id: str) -> None:
        with self._op_lock:
            _, kfile = self._find_knowledge_file(item_id)
            kfile.unlink()

    def move_knowledge(self, item_id: str, target_scope: str) -> dict:
        with self._op_lock:
            old_scope, kfile = self._find_knowledge_file(item_id)
            norm_target = self._normalize_scope(target_scope)
            if old_scope == norm_target:
                return _read_json(kfile, {})
            target_sdir = self._scope_dir(norm_target)
            if norm_target != "general" and not target_sdir.is_dir():
                self._create_project_unlocked(norm_target[len("project:") :])
            target_kdir = target_sdir / KNOWLEDGE_SUBDIR
            target_kdir.mkdir(parents=True, exist_ok=True)
            target_file = target_kdir / kfile.name
            shutil.move(str(kfile), str(target_file))
            data = _read_json(target_file, {})
            data["scope"] = norm_target
            data["updatedAt"] = _now_ms()
            _atomic_write_json(target_file, data)
            return data

    # ---------- Smart Sync, Provenance & Scope-Isolated Assistant ----------

    def compute_scope_hash(self, scope: str) -> str:
        """Compute deterministic SHA-256 over notes, confirmed meeting summaries, and knowledge."""
        norm = self._normalize_scope(scope)
        sdir = self._scope_dir(norm)
        h = hashlib.sha256()
        h.update(norm.encode("utf-8"))

        notes_dir = sdir / NOTES_SUBDIR
        if notes_dir.is_dir():
            for entry in sorted(notes_dir.iterdir(), key=lambda p: p.name):
                if entry.is_file() and entry.suffix.lower() == NOTE_EXT:
                    h.update(f"note:{entry.name}\n".encode())
                    h.update(entry.read_bytes())

        mdir = sdir / MEETINGS_SUBDIR
        if mdir.is_dir():
            for entry in sorted(mdir.iterdir(), key=lambda p: p.name):
                if not entry.is_dir():
                    continue
                if norm == "general" and entry.name.lower() in RESERVED_MEETING_DIRS:
                    continue
                meta = self._load_meeting_summary_record(norm, entry)
                if not meta:
                    continue
                # Synthesize from meeting summary & action items, NEVER raw transcript.json
                payload = {
                    "id": meta.get("id"),
                    "title": meta.get("title"),
                    "date": meta.get("date"),
                    "summary": meta.get("summary", ""),
                    "actionItems": meta.get("actionItems", []),
                }
                h.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"))

        kdir = sdir / KNOWLEDGE_SUBDIR
        if kdir.is_dir():
            for entry in sorted(kdir.iterdir(), key=lambda p: p.name):
                if not entry.is_file() or entry.suffix.lower() != ".json":
                    continue
                data = _read_json(entry, None)
                if not isinstance(data, dict):
                    continue
                payload = {
                    "id": data.get("id", entry.stem),
                    "title": data.get("title", ""),
                    "reason": data.get("reason", ""),
                    "summary": data.get("summary", ""),
                    "read": bool(data.get("read", False)),
                    "date": data.get("date", ""),
                }
                h.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"))

        return h.hexdigest()

    def smart_sync(
        self,
        *,
        scope: str = "all",
        force: bool = False,
        provider: str | None = None,
        model: str | None = None,
        effort: str | None = None,
    ) -> dict:
        with self._op_lock:
            settings = self.get_settings()
            ai_cfg = settings.get("aiDefaults", {}).get("insights", {})
            chosen_provider = provider or ai_cfg.get("provider", "lms")
            chosen_model = model if model is not None else ai_cfg.get("model", "")
            chosen_effort = effort or ai_cfg.get("effort", "medium")

            results: list[dict] = []
            for sc, sdir in self._list_scope_dirs(scope, include_hidden=False):
                current_hash = self.compute_scope_hash(sc)
                insights_file = sdir / "insights.json"
                existing = _read_json(insights_file, None)
                prev_hash = (
                    existing.get("provenance", {}).get("source_hash")
                    if isinstance(existing, dict)
                    else None
                )
                if not force and prev_hash == current_hash and isinstance(existing, dict):
                    results.append(
                        {
                            "scope": sc,
                            "status": "skipped",
                            "tokensUsed": 0,
                            "source_hash": current_hash,
                            "insights": existing,
                        }
                    )
                    continue

                notes = self.list_notes(scope=sc, include_hidden=False)
                meetings = self.list_meetings(scope=sc, limit=50, offset=0)["items"]
                knowledge = self.list_knowledge(scope=sc)
                unread_k = [k for k in knowledge if not k.get("read")]

                provenance = {
                    "provider": chosen_provider,
                    "model": chosen_model,
                    "effort": chosen_effort,
                    "prompt_version": PROMPT_VERSION,
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                    "source_hash": current_hash,
                }
                insights_doc = {
                    "scope": sc,
                    "summary": {
                        "notesCount": len(notes),
                        "meetingsCount": len(meetings),
                        "knowledgeCount": len(knowledge),
                        "unreadKnowledgeCount": len(unread_k),
                        "recentNoteTitles": [n["name"] for n in notes[:5]],
                        "recentMeetingSummaries": [
                            {"id": m["id"], "title": m["title"], "summary": m.get("summary", "")}
                            for m in meetings[:5]
                        ],
                        "recentKnowledgeSummaries": [
                            {"id": k["id"], "title": k["title"], "summary": k.get("summary", "")}
                            for k in knowledge[:5]
                        ],
                    },
                    "provenance": provenance,
                }
                _atomic_write_json(insights_file, insights_doc)
                results.append(
                    {
                        "scope": sc,
                        "status": "synced",
                        "tokensUsed": 1,
                        "source_hash": current_hash,
                        "insights": insights_doc,
                    }
                )
            return {"results": results}

    def query_assistant(
        self,
        query: str,
        *,
        scope: str = "all",
        include_all_scopes: bool = False,
        provider: str | None = None,
        model: str | None = None,
        allow_local_only: bool = False,
    ) -> dict:
        settings = self.get_settings()
        ai_cfg = settings.get("aiDefaults", {}).get("assistant", {})
        chosen_provider = provider or ai_cfg.get("provider", "lms")
        chosen_model = model if model is not None else ai_cfg.get("model", "")
        redact_cloud = bool(settings.get("privacy", {}).get("redactPiiOnCloud", True))

        effective_scope = "all" if include_all_scopes else scope
        notes = self.list_notes(scope=effective_scope, include_hidden=False)
        raw_meetings = self.list_meetings(
            scope=effective_scope, limit=100, offset=0, include_hidden=False
        )["items"]
        knowledge = self.list_knowledge(scope=effective_scope, include_hidden=False)

        allowed_meetings, filtered_count = privacy.filter_meetings_for_provider(
            raw_meetings,
            provider=chosen_provider,
            allow_local_only=allow_local_only,
        )

        is_cloud = privacy.is_cloud_provider(chosen_provider)
        participant_names: list[str] = []
        if is_cloud and redact_cloud:
            for m in allowed_meetings:
                for p in m.get("participants", []):
                    if isinstance(p, dict):
                        for field in ("name", "nickname"):
                            if p.get(field):
                                participant_names.append(str(p[field]))

        def _maybe_redact(text: str) -> str:
            if is_cloud and redact_cloud:
                return privacy.redact_pii(text, names=participant_names)
            return text

        note_hits = db.search_notes(
            self._connect(),
            query,
            scope=None if effective_scope == "all" else self._normalize_scope(effective_scope),
            include_hidden=False,
            limit=10,
        )

        sources = {
            "notes": [
                {"title": n["name"], "path": n["path"], "scope": n["scope"]} for n in notes[:10]
            ],
            "noteHits": [
                {"title": h["title"], "path": h["path"], "snippet": _maybe_redact(h["snippet"])}
                for h in note_hits
            ],
            "meetings": [
                {
                    "id": m["id"],
                    "title": _maybe_redact(m.get("title", "")),
                    "summary": _maybe_redact(m.get("summary", "")),
                    "visibility": m.get("visibility", "local_only"),
                }
                for m in allowed_meetings[:10]
            ],
            "knowledge": [
                {
                    "id": k["id"],
                    "title": _maybe_redact(k.get("title", "")),
                    "summary": _maybe_redact(str(k.get("summary") or "")),
                }
                for k in knowledge[:10]
            ],
        }

        return {
            "query": _maybe_redact(query),
            "scope": effective_scope,
            "provider": chosen_provider,
            "model": chosen_model,
            "filteredLocalOnlyMeetings": filtered_count,
            "redacted": is_cloud and redact_cloud,
            "sources": sources,
        }

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
        self._note_scope_info(note_file)
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
            self._note_scope_info(note_file)
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
            self._note_scope_info(note_file)
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
        self._note_scope_info(note_file)
        decoded = urllib.parse.unquote(asset_rel).replace("\\", "/")
        candidate = (note_file.parent / decoded).resolve()
        candidate.relative_to(note_file.parent.resolve())
        if not candidate.is_file():
            raise FileNotFoundError(asset_rel)
        return candidate

    def inline_note_images(self, note_rel_path: str, content: str) -> str:
        note_file = self.resolve_under_root(note_rel_path)
        self._note_scope_info(note_file)

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

    def search(
        self,
        query: str,
        *,
        scope: str | None = None,
        project_slug: str | None = None,
        include_hidden: bool = False,
        limit: int = 30,
    ) -> list[dict]:
        user_words: list[str] = []
        if project_slug:
            pdir = self.projects_root / sanitize_name(project_slug, "")
            if pdir.is_dir():
                user_words = self._read_project_meta(pdir).get("glossary", [])
        elif scope and scope.startswith("project:"):
            pdir = self.projects_root / sanitize_name(scope[len("project:") :], "")
            if pdir.is_dir():
                user_words = self._read_project_meta(pdir).get("glossary", [])
        with self._connect() as conn:
            return db.search_notes(
                conn,
                query,
                scope=scope,
                project_slug=project_slug,
                include_hidden=include_hidden,
                limit=limit,
                user_words=user_words,
            )

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
            _atomic_write_json(self.session_file, payload)
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
