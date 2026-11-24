"""FastAPI local backend for PlainMark v2."""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import backup, config, diarize, ocr, voiceprint, wordseg
from .storage import WorkspaceStorage


class CreateProjectBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    repoPath: str | None = None
    glossary: list[str] | None = None
    hidden: bool = False
    defaultVisibility: str | None = None


class UpdateProjectBody(BaseModel):
    name: str | None = None
    repoPath: str | None = None
    glossary: list[str] | None = None
    hidden: bool | None = None
    defaultVisibility: str | None = None


class CreateNoteBody(BaseModel):
    projectSlug: str | None = None
    scope: str | None = None
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
    targetProjectSlug: str | None = None
    targetScope: str | None = None


class UnifiedMoveBody(BaseModel):
    itemType: str = Field(pattern="^(note|meeting|knowledge)$")
    idOrPath: str = Field(min_length=1)
    targetScope: str = Field(min_length=1)


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


class CreateScratchBody(BaseModel):
    title: str | None = None
    content: str = ""


class UpdateScratchBody(BaseModel):
    content: str
    title: str | None = None


class PromoteScratchBody(BaseModel):
    targetScope: str = "general"
    title: str | None = None
    keepScratch: bool = False


class SmartSyncBody(BaseModel):
    scope: str = "all"
    force: bool = False
    provider: str | None = None
    model: str | None = None
    effort: str | None = None


class AssistantQueryBody(BaseModel):
    query: str = Field(min_length=1)
    scope: str = "all"
    includeAllScopes: bool = False
    provider: str | None = None
    model: str | None = None
    allowLocalOnly: bool = False


class BackupRunBody(BaseModel):
    destination: str | None = None
    keepDaily: int | None = None
    keepWeekly: int | None = None


class TranscriptUpdateBody(BaseModel):
    segments: list[dict]
    reason: str = "edit"


class DiarizeBody(BaseModel):
    audioTrack: int = Field(default=1, ge=1)
    micTrack: int | None = Field(default=None, ge=1)


class NameSpeakerBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    remember: bool = False
    voiceprintId: str | None = None


class RenameSpeakerBody(BaseModel):
    oldSpeakerId: str = Field(min_length=1)
    newName: str = Field(min_length=1)
    newSpeakerId: str | None = None


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
            "wordsegEngine": wordseg.active_engine(),
            "legacyNotesAvailable": legacy_dir.is_dir(),
            "legacyNotesPath": str(legacy_dir),
            "ocrModelReady": ocr.model_ready(),
            "diarizeModelReady": diarize.model_ready(),
            "voiceprintModelReady": voiceprint.model_ready(),
            "modules": {
                "notes": "ready",
                "scratches": "ready",
                "board": "ready",
                "meetings": "metadata_ready",
                "knowledge": "metadata_ready",
                "insights": "ready",
            },
        }

    # ---------- Projects ----------

    @app.get("/api/projects")
    def list_projects(includeHidden: bool = Query(True)) -> dict:
        return {
            "dataRoot": str(storage.root),
            "projects": storage.list_projects(include_hidden=includeHidden),
        }

    @app.post("/api/projects")
    def create_project(body: CreateProjectBody) -> dict:
        return storage.create_project(
            body.name,
            repo_path=body.repoPath,
            glossary=body.glossary,
            hidden=body.hidden,
            default_visibility=body.defaultVisibility,
        )

    @app.patch("/api/projects/{slug}")
    def update_project(slug: str, body: UpdateProjectBody) -> dict:
        try:
            return storage.update_project(
                slug,
                name=body.name,
                repo_path=body.repoPath,
                glossary=body.glossary,
                hidden=body.hidden,
                default_visibility=body.defaultVisibility,
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

    @app.get("/api/notes")
    def list_notes(
        scope: str = Query("all"),
        includeHidden: bool = Query(False),
    ) -> dict:
        try:
            return {"notes": storage.list_notes(scope=scope, include_hidden=includeHidden)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes")
    def create_note(body: CreateNoteBody) -> dict:
        try:
            return storage.create_note(body.projectSlug, body.title, scope=body.scope)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

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
            return storage.move_note(
                body.path, body.targetProjectSlug, target_scope=body.targetScope
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Note not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/move")
    def move_item(body: UnifiedMoveBody) -> dict:
        try:
            if body.itemType == "note":
                return storage.move_note(body.idOrPath, target_scope=body.targetScope)
            if body.itemType == "meeting":
                return storage.move_meeting(body.idOrPath, body.targetScope)
            return storage.move_knowledge(body.idOrPath, body.targetScope)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/notes/delete")
    def delete_note(body: DeleteNoteBody) -> dict:
        try:
            storage.delete_note(body.path)
            return {"deleted": True}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Scratches ----------

    @app.get("/api/scratches")
    def list_scratches() -> dict:
        return {"scratches": storage.list_scratches()}

    @app.post("/api/scratches")
    def create_scratch(body: CreateScratchBody) -> dict:
        return storage.create_scratch(title=body.title, content=body.content)

    @app.get("/api/scratches/{scratch_id}")
    def read_scratch(scratch_id: str) -> dict:
        try:
            return storage.read_scratch(scratch_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Scratch not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.put("/api/scratches/{scratch_id}")
    def update_scratch(scratch_id: str, body: UpdateScratchBody) -> dict:
        try:
            return storage.update_scratch(scratch_id, body.content, title=body.title)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Scratch not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/scratches/{scratch_id}")
    def delete_scratch(scratch_id: str) -> dict:
        try:
            storage.delete_scratch(scratch_id)
            return {"deleted": True}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/scratches/{scratch_id}/promote")
    def promote_scratch(scratch_id: str, body: PromoteScratchBody) -> dict:
        try:
            return storage.promote_scratch(
                scratch_id,
                target_scope=body.targetScope,
                title=body.title,
                keep_scratch=body.keepScratch,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Scratch not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Board & Closed Items ----------

    @app.get("/api/board")
    def get_board(scope: str = Query("general")) -> dict:
        try:
            return storage.get_board(scope)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.put("/api/board")
    def put_board(payload: dict, scope: str = Query("general")) -> dict:
        try:
            return storage.save_board(scope, payload)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/closed-items")
    def list_closed_items(scope: str | None = Query(None)) -> dict:
        try:
            return {"items": storage.list_closed_items(scope=scope)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/closed-items")
    def create_closed_item(payload: dict) -> dict:
        try:
            return storage.record_closed_item(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/closed-items/{item_id}/restore")
    def restore_closed_item(item_id: str) -> dict:
        try:
            return storage.restore_closed_item(item_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Closed item not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Smart Sync, Settings, CLI Discovery, Assistant ----------

    @app.post("/api/sync/smart")
    def smart_sync(body: SmartSyncBody) -> dict:
        try:
            return storage.smart_sync(
                scope=body.scope,
                force=body.force,
                provider=body.provider,
                model=body.model,
                effort=body.effort,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/settings")
    def get_settings() -> dict:
        return {"settings": storage.get_settings(), "cliCache": storage.get_cli_models_cache()}

    @app.put("/api/settings")
    def put_settings(payload: dict) -> dict:
        return {"settings": storage.update_settings(payload)}

    @app.post("/api/cli/discover")
    def discover_clis() -> dict:
        return storage.discover_cli_models()

    @app.post("/api/assistant/query")
    def assistant_query(body: AssistantQueryBody) -> dict:
        try:
            return storage.query_assistant(
                body.query,
                scope=body.scope,
                include_all_scopes=body.includeAllScopes,
                provider=body.provider,
                model=body.model,
                allow_local_only=body.allowLocalOnly,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Backup & Index Rebuild ----------

    @app.post("/api/backup/run")
    def run_backup_endpoint(body: BackupRunBody) -> dict:
        settings = storage.get_settings()
        backup_cfg = settings.get("backup", {})
        dest = body.destination or backup_cfg.get("destination")
        if not dest:
            raise HTTPException(status_code=400, detail="Backup destination is required")
        try:
            return backup.run_backup(
                storage.root,
                Path(dest),
                keep_daily=body.keepDaily or int(backup_cfg.get("keepDaily", 7)),
                keep_weekly=body.keepWeekly or int(backup_cfg.get("keepWeekly", 4)),
            )
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/backup/status")
    def backup_status() -> dict:
        backup_cfg = storage.get_settings().get("backup", {})
        return {"backup": backup_cfg}

    @app.post("/api/index/rebuild")
    def rebuild_index() -> dict:
        count = storage.rebuild_index_from_disk()
        return {"rebuilt": True, "indexedNotes": count}

    # ---------- Meetings ----------

    @app.get("/api/meetings")
    def list_meetings(
        scope: str = Query("all"),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
        q: str | None = Query(None),
        includeHidden: bool = Query(False),
    ) -> dict:
        try:
            return storage.list_meetings(
                scope=scope,
                limit=limit,
                offset=offset,
                q=q,
                include_hidden=includeHidden,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/meetings")
    def create_meeting(payload: dict) -> dict:
        try:
            return storage.create_meeting(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/meetings/{meeting_id}")
    def get_meeting(meeting_id: str) -> dict:
        try:
            return storage.get_meeting(meeting_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/meetings/{meeting_id}")
    def update_meeting(meeting_id: str, payload: dict) -> dict:
        try:
            return storage.update_meeting(meeting_id, payload)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/meetings/{meeting_id}")
    def delete_meeting(meeting_id: str) -> dict:
        try:
            storage.delete_meeting(meeting_id)
            return {"deleted": True}
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.put("/api/meetings/{meeting_id}/transcript")
    def update_meeting_transcript(meeting_id: str, body: TranscriptUpdateBody) -> dict:
        try:
            return storage.update_meeting_transcript(
                meeting_id, body.segments, reason=body.reason
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/meetings/{meeting_id}/rename-speaker")
    def rename_meeting_speaker(meeting_id: str, body: RenameSpeakerBody) -> dict:
        try:
            return storage.rename_meeting_speaker(
                meeting_id,
                body.oldSpeakerId,
                body.newName,
                new_speaker_id=body.newSpeakerId,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/meetings/{meeting_id}/history")
    def list_meeting_history(meeting_id: str) -> dict:
        try:
            return {"snapshots": storage.list_meeting_history(meeting_id)}
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/meetings/{meeting_id}/captures")
    async def add_meeting_capture(
        meeting_id: str,
        file: UploadFile = File(...),
        timeSec: float = Form(0.0),
        kind: str = Form("frame"),
        region: str = Form(""),
    ) -> dict:
        try:
            region_obj = json.loads(region) if region else None
            data = await file.read()
            return storage.add_meeting_capture(
                meeting_id,
                data,
                timeSec,
                kind,
                region_obj if isinstance(region_obj, dict) else None,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/meetings/{meeting_id}/captures/{name}")
    def get_meeting_capture(meeting_id: str, name: str) -> FileResponse:
        try:
            path = storage.resolve_meeting_capture(meeting_id, name)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Capture not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return FileResponse(path, media_type="image/png")

    @app.post("/api/meetings/{meeting_id}/keyframes/{keyframe_id}/ocr")
    def rerun_keyframe_ocr(meeting_id: str, keyframe_id: str) -> dict:
        try:
            return storage.run_keyframe_ocr(meeting_id, keyframe_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Keyframe not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/meetings/{meeting_id}/diarize")
    def start_meeting_diarization(meeting_id: str, body: DiarizeBody | None = None) -> dict:
        body = body or DiarizeBody()
        mic = body.micTrack - 1 if body.micTrack else None
        try:
            return storage.start_meeting_diarization(meeting_id, body.audioTrack - 1, mic)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/meetings/{meeting_id}/diarization")
    def get_meeting_diarization(meeting_id: str) -> dict:
        try:
            return storage.get_meeting_diarization(meeting_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/meetings/{meeting_id}/diarization/speakers/{speaker_id}")
    def name_meeting_speaker(meeting_id: str, speaker_id: str, body: NameSpeakerBody) -> dict:
        try:
            return storage.name_meeting_speaker(
                meeting_id,
                speaker_id,
                body.name,
                remember=body.remember,
                voiceprint_id=body.voiceprintId,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Meeting or speaker not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/meetings/{meeting_id}/keyframes/{keyframe_id}")
    def delete_meeting_keyframe(meeting_id: str, keyframe_id: str) -> dict:
        try:
            return storage.delete_meeting_keyframe(meeting_id, keyframe_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Keyframe not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ---------- Meeting media (videos stay in the recording folder) ----------

    @app.get("/api/media/videos")
    def list_media_videos() -> dict:
        return storage.list_media_files()

    @app.get("/api/media/file")
    def get_media_file(path: str = Query(..., min_length=1)) -> FileResponse:
        try:
            video = storage.resolve_media_file(path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Video not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        media_type = mimetypes.guess_type(video.name)[0] or "video/mp4"
        return FileResponse(video, media_type=media_type)

    # ---------- Voiceprints & Contacts ----------

    @app.get("/api/voiceprints")
    def list_voiceprints() -> dict:
        return {"voiceprints": storage.list_voiceprints()}

    @app.post("/api/voiceprints")
    def create_voiceprint(payload: dict) -> dict:
        try:
            return storage.upsert_voiceprint(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/voiceprints/{vp_id}")
    def update_voiceprint(vp_id: str, payload: dict) -> dict:
        try:
            return storage.upsert_voiceprint(payload, vp_id=vp_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/voiceprints/{vp_id}")
    def delete_voiceprint(vp_id: str) -> dict:
        try:
            deleted = storage.delete_voiceprint(vp_id)
            if not deleted:
                raise HTTPException(status_code=404, detail="Voiceprint not found")
            return {"deleted": True, "id": vp_id}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/contacts")
    def list_contacts() -> dict:
        return {"contacts": storage.list_contacts()}

    @app.post("/api/contacts")
    def upsert_contact(payload: dict) -> dict:
        return storage.upsert_contact(payload)

    @app.delete("/api/contacts/{contact_id}")
    def delete_contact(contact_id: str) -> dict:
        deleted = storage.delete_contact(contact_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Contact not found")
        return {"deleted": True}

    # ---------- Knowledge ----------

    @app.get("/api/knowledge")
    def list_knowledge(
        scope: str = Query("all"),
        read: bool | None = Query(None),
        date: str | None = Query(None),
        dateFrom: str | None = Query(None),
        dateTo: str | None = Query(None),
        includeHidden: bool = Query(False),
    ) -> dict:
        try:
            return {
                "items": storage.list_knowledge(
                    scope=scope,
                    read=read,
                    date=date,
                    date_from=dateFrom,
                    date_to=dateTo,
                    include_hidden=includeHidden,
                )
            }
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/knowledge")
    def create_knowledge(payload: dict) -> dict:
        try:
            return storage.create_knowledge(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/knowledge/{item_id}")
    def update_knowledge(item_id: str, payload: dict) -> dict:
        try:
            return storage.update_knowledge(item_id, payload)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Knowledge item not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/knowledge/{item_id}")
    def delete_knowledge(item_id: str) -> dict:
        try:
            storage.delete_knowledge(item_id)
            return {"deleted": True}
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Knowledge item not found") from exc
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
        scope: str | None = Query(None),
        project: str | None = Query(None),
        includeHidden: bool = Query(False),
        limit: int = Query(30, ge=1, le=100),
    ) -> dict:
        return {
            "results": storage.search(
                q,
                scope=scope,
                project_slug=project,
                include_hidden=includeHidden,
                limit=limit,
            )
        }

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
