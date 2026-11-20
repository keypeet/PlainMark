"""SQLite metadata and search index (source of truth stays Markdown files on disk)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

USER_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes_index (
    rel_path TEXT PRIMARY KEY,
    project_slug TEXT NOT NULL,
    project_name TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes_index(project_slug);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    rel_path UNINDEXED,
    project_slug UNINDEXED,
    title,
    content,
    tokenize='unicode61'
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version < USER_VERSION:
        conn.execute(f"PRAGMA user_version = {USER_VERSION}")
    conn.commit()
    return conn


def upsert_note(
    conn: sqlite3.Connection,
    *,
    rel_path: str,
    project_slug: str,
    project_name: str,
    title: str,
    content: str,
    created_at: int,
    updated_at: int,
) -> None:
    conn.execute(
        """
        INSERT INTO notes_index(
            rel_path, project_slug, project_name, title, content, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rel_path) DO UPDATE SET
            project_slug=excluded.project_slug,
            project_name=excluded.project_name,
            title=excluded.title,
            content=excluded.content,
            updated_at=excluded.updated_at
        """,
        (rel_path, project_slug, project_name, title, content, created_at, updated_at),
    )
    conn.execute("DELETE FROM notes_fts WHERE rel_path = ?", (rel_path,))
    conn.execute(
        "INSERT INTO notes_fts(rel_path, project_slug, title, content) VALUES (?, ?, ?, ?)",
        (rel_path, project_slug, title, content),
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
    for row in rows:
        conn.execute(
            """
            INSERT INTO notes_index(
                rel_path, project_slug, project_name, title, content, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["rel_path"],
                row["project_slug"],
                row["project_name"],
                row["title"],
                row["content"],
                row["created_at"],
                row["updated_at"],
            ),
        )
        conn.execute(
            "INSERT INTO notes_fts(rel_path, project_slug, title, content) VALUES (?, ?, ?, ?)",
            (row["rel_path"], row["project_slug"], row["title"], row["content"]),
        )
    conn.commit()


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


def search_notes(
    conn: sqlite3.Connection,
    query: str,
    *,
    project_slug: str | None = None,
    limit: int = 30,
) -> list[dict]:
    """Search notes using FTS5 first, then LIKE substring fallback (handles unspaced Thai)."""
    cleaned = query.strip()
    if not cleaned:
        return []

    seen: set[str] = set()
    results: list[dict] = []

    # 1) FTS5 match for tokenized terms (fast for English / space-separated Thai)
    safe_fts = '"' + cleaned.replace('"', '""') + '"'
    try:
        sql = """
            SELECT n.rel_path, n.project_slug, n.project_name, n.title, n.content, n.updated_at
            FROM notes_fts f
            JOIN notes_index n ON n.rel_path = f.rel_path
            WHERE notes_fts MATCH ?
        """
        params: list[object] = [safe_fts]
        if project_slug:
            sql += " AND n.project_slug = ?"
            params.append(project_slug)
        sql += " ORDER BY bm25(notes_fts), n.updated_at DESC LIMIT ?"
        params.append(limit)
        for row in conn.execute(sql, params).fetchall():
            seen.add(row["rel_path"])
            results.append(
                {
                    "path": row["rel_path"],
                    "projectSlug": row["project_slug"],
                    "projectName": row["project_name"],
                    "title": row["title"],
                    "snippet": _extract_snippet(row["content"], cleaned),
                    "updatedAt": row["updated_at"],
                }
            )
    except sqlite3.OperationalError:
        pass

    # 2) Substring fallback (essential for Thai without word spaces)
    if len(results) < limit:
        like_pat = f"%{cleaned}%"
        sql = """
            SELECT rel_path, project_slug, project_name, title, content, updated_at
            FROM notes_index
            WHERE (title LIKE ? OR content LIKE ?)
        """
        params = [like_pat, like_pat]
        if project_slug:
            sql += " AND project_slug = ?"
            params.append(project_slug)
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        for row in conn.execute(sql, params).fetchall():
            if row["rel_path"] in seen:
                continue
            seen.add(row["rel_path"])
            results.append(
                {
                    "path": row["rel_path"],
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
