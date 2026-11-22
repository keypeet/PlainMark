"""SQLite metadata and search index (source of truth stays Markdown files on disk)."""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path

from . import wordseg

USER_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes_index (
    rel_path TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    project_slug TEXT NOT NULL,
    project_name TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_scope ON notes_index(scope);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes_index(project_slug);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    rel_path UNINDEXED,
    scope UNINDEXED,
    project_slug UNINDEXED,
    hidden UNINDEXED,
    title_raw,
    content_raw,
    title_seg,
    content_seg,
    tokenize='unicode61'
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if 0 < version < USER_VERSION:
        conn.executescript(
            """
            DROP TABLE IF EXISTS notes_fts;
            DROP TABLE IF EXISTS notes_index;
            """
        )
    conn.executescript(SCHEMA)
    if version < USER_VERSION:
        conn.execute(f"PRAGMA user_version = {USER_VERSION}")
    conn.commit()
    return conn


def _fts_quote(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def _build_fts_query(cleaned: str, user_words: Sequence[str] | None = None) -> str:
    raw_phrase = _fts_quote(cleaned)
    tokens = wordseg.tokenize_query(cleaned, user_words=user_words)
    if not tokens:
        return raw_phrase
    seg_clause = " AND ".join(_fts_quote(tok) for tok in tokens)
    if len(tokens) > 1:
        seg_expr = f"({{title_seg content_seg}} : ({seg_clause}))"
    else:
        seg_expr = f"({{title_seg content_seg}} : {seg_clause})"
    return f"{seg_expr} OR ({{title_raw content_raw}} : {raw_phrase})"


def upsert_note(
    conn: sqlite3.Connection,
    *,
    rel_path: str,
    scope: str = "project:Inbox",
    project_slug: str,
    project_name: str,
    hidden: bool = False,
    title: str,
    content: str,
    created_at: int,
    updated_at: int,
    user_words: Sequence[str] | None = None,
    title_seg: str | None = None,
    content_seg: str | None = None,
) -> None:
    t_seg = (
        title_seg
        if title_seg is not None
        else wordseg.segment_for_fts(title, user_words=user_words)
    )
    c_seg = (
        content_seg
        if content_seg is not None
        else wordseg.segment_for_fts(content, user_words=user_words)
    )
    hidden_int = 1 if hidden else 0

    conn.execute(
        """
        INSERT INTO notes_index(
            rel_path, scope, project_slug, project_name,
            hidden, title, content, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rel_path) DO UPDATE SET
            scope=excluded.scope,
            project_slug=excluded.project_slug,
            project_name=excluded.project_name,
            hidden=excluded.hidden,
            title=excluded.title,
            content=excluded.content,
            updated_at=excluded.updated_at
        """,
        (
            rel_path,
            scope,
            project_slug,
            project_name,
            hidden_int,
            title,
            content,
            created_at,
            updated_at,
        ),
    )
    conn.execute("DELETE FROM notes_fts WHERE rel_path = ?", (rel_path,))
    conn.execute(
        """
        INSERT INTO notes_fts(
            rel_path, scope, project_slug, hidden, title_raw, content_raw, title_seg, content_seg
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (rel_path, scope, project_slug, hidden_int, title, content, t_seg, c_seg),
    )
    conn.commit()


def delete_note_index(conn: sqlite3.Connection, rel_path: str) -> None:
    conn.execute("DELETE FROM notes_index WHERE rel_path = ?", (rel_path,))
    conn.execute("DELETE FROM notes_fts WHERE rel_path = ?", (rel_path,))
    conn.commit()


def delete_project_index(conn: sqlite3.Connection, project_slug: str) -> None:
    conn.execute("DELETE FROM notes_index WHERE project_slug = ?", (project_slug,))
    conn.execute("DELETE FROM notes_fts WHERE project_slug = ?", (project_slug,))
    conn.commit()


def replace_all_index(conn: sqlite3.Connection, rows: list[dict]) -> None:
    conn.execute("DELETE FROM notes_index")
    conn.execute("DELETE FROM notes_fts")
    index_rows: list[tuple] = []
    fts_rows: list[tuple] = []
    for row in rows:
        user_words = row.get("user_words")
        scope = row.get("scope") or f"project:{row['project_slug']}"
        hidden_int = 1 if row.get("hidden") else 0
        title_seg = row.get("title_seg")
        if title_seg is None:
            title_seg = wordseg.segment_for_fts(row["title"], user_words=user_words)
        content_seg = row.get("content_seg")
        if content_seg is None:
            content_seg = wordseg.segment_for_fts(row["content"], user_words=user_words)

        index_rows.append(
            (
                row["rel_path"],
                scope,
                row["project_slug"],
                row["project_name"],
                hidden_int,
                row["title"],
                row["content"],
                row["created_at"],
                row["updated_at"],
            )
        )
        fts_rows.append(
            (
                row["rel_path"],
                scope,
                row["project_slug"],
                hidden_int,
                row["title"],
                row["content"],
                title_seg,
                content_seg,
            )
        )
    conn.executemany(
        """
        INSERT INTO notes_index(
            rel_path, scope, project_slug, project_name,
            hidden, title, content, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        index_rows,
    )
    conn.executemany(
        """
        INSERT INTO notes_fts(
            rel_path, scope, project_slug, hidden, title_raw, content_raw, title_seg, content_seg
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        fts_rows,
    )
    conn.commit()


def rebuild_index_from_disk(db_path: Path, rows: list[dict]) -> int:
    """Drop and recreate plainmark.sqlite from disk rows (Derived Index Guarantee)."""
    for suffix in ("", "-wal", "-shm"):
        candidate = db_path.with_name(db_path.name + suffix)
        if candidate.exists():
            candidate.unlink()
    with connect(db_path) as conn:
        replace_all_index(conn, rows)
    return len(rows)


def _extract_snippet(content: str, query: str, radius: int = 60) -> str:
    lower_content = content.lower()
    lower_query = query.lower()
    idx = lower_content.find(lower_query)
    if idx == -1:
        first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
        return first_line[:140]
    start = max(0, idx - radius)
    end = min(len(content), idx + len(query) + radius)
    snippet = content[start:end].replace("\n", " ").strip()
    if start > 0:
        snippet = "…" + snippet
    if end < len(content):
        snippet = snippet + "…"
    return snippet


def _apply_scope_filter(
    sql: str,
    params: list[object],
    *,
    alias: str,
    scope: str | None,
    project_slug: str | None,
    include_hidden: bool,
) -> str:
    if project_slug:
        sql += f" AND {alias}.project_slug = ?"
        params.append(project_slug)
    elif scope and scope != "all":
        sql += f" AND {alias}.scope = ?"
        params.append(scope)
    elif not include_hidden:
        sql += f" AND {alias}.hidden = 0"
    return sql


def search_notes(
    conn: sqlite3.Connection,
    query: str,
    *,
    scope: str | None = None,
    project_slug: str | None = None,
    include_hidden: bool = False,
    limit: int = 30,
    user_words: Sequence[str] | None = None,
) -> list[dict]:
    """Search notes using WordSeg FTS5 first, then LIKE substring fallback."""
    cleaned = query.strip()
    if not cleaned:
        return []

    seen: set[str] = set()
    results: list[dict] = []

    fts_expr = _build_fts_query(cleaned, user_words=user_words)
    try:
        sql = """
            SELECT n.rel_path, n.scope, n.project_slug, n.project_name,
                   n.title, n.content, n.updated_at
            FROM notes_fts f
            JOIN notes_index n ON n.rel_path = f.rel_path
            WHERE notes_fts MATCH ?
        """
        params: list[object] = [fts_expr]
        sql = _apply_scope_filter(
            sql,
            params,
            alias="n",
            scope=scope,
            project_slug=project_slug,
            include_hidden=include_hidden,
        )
        sql += " ORDER BY bm25(notes_fts), n.updated_at DESC LIMIT ?"
        params.append(limit)
        for row in conn.execute(sql, params).fetchall():
            seen.add(row["rel_path"])
            results.append(
                {
                    "path": row["rel_path"],
                    "scope": row["scope"],
                    "projectSlug": row["project_slug"],
                    "projectName": row["project_name"],
                    "title": row["title"],
                    "snippet": _extract_snippet(row["content"], cleaned),
                    "updatedAt": row["updated_at"],
                }
            )
    except sqlite3.OperationalError:
        pass

    if len(results) < limit:
        like_pat = f"%{cleaned}%"
        sql = """
            SELECT rel_path, scope, project_slug, project_name, title, content, updated_at
            FROM notes_index
            WHERE (title LIKE ? OR content LIKE ?)
        """
        params = [like_pat, like_pat]
        sql = _apply_scope_filter(
            sql,
            params,
            alias="notes_index",
            scope=scope,
            project_slug=project_slug,
            include_hidden=include_hidden,
        )
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        for row in conn.execute(sql, params).fetchall():
            if row["rel_path"] in seen:
                continue
            seen.add(row["rel_path"])
            results.append(
                {
                    "path": row["rel_path"],
                    "scope": row["scope"],
                    "projectSlug": row["project_slug"],
                    "projectName": row["project_name"],
                    "title": row["title"],
                    "snippet": _extract_snippet(row["content"], cleaned),
                    "updatedAt": row["updated_at"],
                }
            )
            if len(results) >= limit:
                break

    return results
