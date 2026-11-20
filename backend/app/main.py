"""FastAPI local backend for PlainMark v2."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config
from .storage import WorkspaceStorage


class CreateProjectBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    repoPath: str | None = None
    glossary: list[str] | None = None


class UpdateProjectBody(BaseModel):
    name: str | None = None
    repoPath: str | None = None
    glossary: list[str] | None = None


class CreateNoteBody(BaseModel):
    projectSlug: str | None = None
    title: str | None = None


class WriteNoteBody(BaseModel):
    path: str
    content: str
    mustExist: bool = True
    historyIntervalMin: int = 5
    historyKeep: int = 30


class RenameNoteBody(BaseModel):
    path: str
    newTitle: str = Field(min_length=1, max_length=160)


class MoveNoteBody(BaseModel):
    path: str
    targetProjectSlug: str = Field(min_length=1)


class DeleteNoteBody(BaseModel):
    path: str


class SaveSnapshotBody(BaseModel):
    path: str
    content: str
    keep: int = 30


class InlineImagesBody(BaseModel):
    path: str
    content: str


class ImportLegacyBody(BaseModel):
    sourceDir: str | None = None


def create_app(data_root: Path | None = None) -> FastAPI:
    storage = WorkspaceStorage(data_root or config.default_data_root())
    app = FastAPI(title="PlainMark v2 Local API", version="2.0.0")
    app.state.storage = storage

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:1420",
            "http://localhost:1420",
            f"http://127.0.0.1:{config.server_port()}",
            f"http://localhost:{config.server_port()}",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict:
        legacy_dir = Path.home() / "Documents" / "PlainMark"
        return {
            "status": "ok",
            "version": "2.0.0",
            "dataRoot": str(storage.root),
            "legacyNotesAvailable": legacy_dir.is_dir(),
            "legacyNotesPath": str(legacy_dir),
            "modules": {
                "notes": "ready",
                "meetings": "planned",
                "knowledge": "planned",
                "insights": "planned",
            },
        }

    # ---------- Projects ----------

    @app.get("/api/projects")
    def list_projects() -> dict:
        return {"dataRoot": str(storage.root), "projects": storage.list_projects()}

    @app.post("/api/projects")
    def create_project(body: CreateProjectBody) -> dict:
        return storage.create_project(
            body.name, repo_path=body.repoPath, glossary=body.glossary
        )

    @app.patch("/api/projects/{slug}")
    def update_project(slug: str, body: UpdateProjectBody) -> dict:
        try:
            return storage.update_project(
                slug, name=body.name, repo_path=body.repoPath, glossary=body.glossary
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (FileExistsError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/projects/{slug}")
    def delete_project(slug: str) -> dict:
        try:
            storage.delete_project(slug)
            return {"deleted": True, "slug": slug}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Notes ----------

    @app.post("/api/notes")
    def create_note(body: CreateNoteBody) -> dict:
        return storage.create_note(body.projectSlug, body.title)

    @app.get("/api/notes/read")
    def read_note(path: str = Query(..., min_length=1)) -> dict:
        try:
            return storage.read_note(path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Note not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes/write")
    def write_note(body: WriteNoteBody) -> dict:
        try:
            return storage.write_note(
                body.path,
                body.content,
                must_exist=body.mustExist,
                history_interval_min=body.historyIntervalMin,
                history_keep=body.historyKeep,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes/rename")
    def rename_note(body: RenameNoteBody) -> dict:
        try:
            return storage.rename_note(body.path, body.newTitle)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Note not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes/move")
    def move_note(body: MoveNoteBody) -> dict:
        try:
            return storage.move_note(body.path, body.targetProjectSlug)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Note not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes/delete")
    def delete_note(body: DeleteNoteBody) -> dict:
        try:
            storage.delete_note(body.path)
            return {"deleted": True}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- History ----------

    @app.get("/api/notes/history")
    def list_history(path: str = Query(..., min_length=1)) -> dict:
        try:
            return {"snapshots": storage.list_snapshots(path)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/notes/history/read")
    def read_history(path: str = Query(..., min_length=1)) -> dict:
        try:
            return {"path": path, "content": storage.read_snapshot(path)}
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Snapshot not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes/history/save")
    def save_history(body: SaveSnapshotBody) -> dict:
        try:
            saved = storage.save_snapshot(body.path, body.content, keep=body.keep)
            return {"saved": saved is not None, "snapshot": saved}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Assets ----------

    @app.post("/api/notes/assets")
    async def upload_asset(
        notePath: str = Form(...),
        file: UploadFile = File(...),
    ) -> dict:
        try:
            data = await file.read()
            rel = storage.save_image_asset(
                notePath, file.filename or "image.png", file.content_type, data
            )
            return {"relativePath": rel}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/notes/assets/file")
    def get_asset_file(
        notePath: str = Query(..., min_length=1),
        rel: str = Query(..., min_length=1),
    ) -> FileResponse:
        try:
            asset = storage.resolve_asset_file(notePath, rel)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Asset not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        media_type = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
        return FileResponse(asset, media_type=media_type)

    @app.post("/api/notes/inline-images")
    def inline_images(body: InlineImagesBody) -> dict:
        try:
            return {"content": storage.inline_note_images(body.path, body.content)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Search, Session & Legacy Import ----------

    @app.get("/api/search")
    def search(
        q: str = Query("", max_length=200),
        project: str | None = Query(None),
        limit: int = Query(30, ge=1, le=100),
    ) -> dict:
        return {"results": storage.search(q, project_slug=project, limit=limit)}

    @app.get("/api/session")
    def get_session() -> dict:
        return {"session": storage.load_session()}

    @app.put("/api/session")
    def put_session(payload: dict) -> dict:
        return storage.save_session(payload)

    @app.post("/api/import-legacy")
    def import_legacy(body: ImportLegacyBody) -> dict:
        source = (
            Path(body.sourceDir)
            if body.sourceDir
            else (Path.home() / "Documents" / "PlainMark")
        )
        try:
            return storage.import_legacy_folder(source)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=f"Not found: {exc}") from exc

    # ---------- Serve built frontend when dist/ exists ----------
    static_root = config.dist_dir()
    if static_root.is_dir() and (static_root / "index.html").is_file():
        assets_dir = static_root / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}")
        def serve_spa(full_path: str) -> FileResponse:
            candidate = (static_root / full_path).resolve()
            try:
                candidate.relative_to(static_root.resolve())
                if full_path and candidate.is_file():
                    return FileResponse(candidate)
            except ValueError:
                pass
            return FileResponse(static_root / "index.html")

    return app


app = create_app()
