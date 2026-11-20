import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  FolderGit2,
  FolderInput,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import type { NoteMeta, ProjectMeta } from '../../lib/noteService';
import { useDocStore } from '../../store/docStore';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';

interface NotesGroupProps {
  project: ProjectMeta;
  allProjects: ProjectMeta[];
  onOpenNote: (note: NoteMeta) => void;
  onCreateNote: (projectSlug: string) => void;
  onNotice: (msg: string) => void;
  draggedNote: NoteMeta | null;
  isDropTarget: boolean;
  isDragOver: boolean;
  onNoteDragStart: (note: NoteMeta) => void;
  onNoteDragEnd: () => void;
  onDragOverProject: () => void;
  onDragLeaveProject: () => void;
}

export function NotesGroup({
  project,
  allProjects,
  onOpenNote,
  onCreateNote,
  onNotice,
  draggedNote,
  isDropTarget,
  isDragOver,
  onNoteDragStart,
  onNoteDragEnd,
  onDragOverProject,
  onDragLeaveProject
}: NotesGroupProps) {
  const { selectedProjectSlug, selectProject, editProject, removeProject, renameNoteAt, moveNoteTo, removeNote } =
    useNotesStore();
  const hidePath = useSettingsStore((state) => state.hidePath);
  const activeNotePath = useDocStore((state) => state.notePath);
  const activeProjectSlug = useDocStore((state) => state.projectSlug);
  const [collapsed, setCollapsed] = useState(false);
  const [movingNotePath, setMovingNotePath] = useState<string | null>(null);

  const isSelected = activeProjectSlug ? activeProjectSlug === project.slug : selectedProjectSlug === project.slug;

  const handleEditProject = () => {
    const nextName = window.prompt('เปลี่ยนชื่อโปรเจค:', project.name);
    if (nextName === null) return;
    const nextRepo = window.prompt(
      'โฟลเดอร์โค้ด/งานที่ผูกไว้ (เว้นว่างเพื่อยกเลิกการผูก):',
      project.repoPath ?? ''
    );
    if (nextRepo === null) return;
    const trimmedName = nextName.trim();
    const trimmedRepo = nextRepo.trim();
    if (trimmedName === project.name && (trimmedRepo || null) === (project.repoPath ?? null)) return;

    editProject(project.slug, {
      name: trimmedName || project.name,
      repoPath: trimmedRepo || ''
    })
      .then((updated) => {
        if (!updated) return;
        // Sync any open tabs whose paths moved under the renamed project slug
        if (updated.slug !== project.slug) {
          const oldPrefix = `projects/${project.slug}/notes/`;
          const newPrefix = `projects/${updated.slug}/notes/`;
          for (const tab of useDocStore.getState().tabs) {
            if (tab.notePath?.startsWith(oldPrefix)) {
              const newPath = newPrefix + tab.notePath.slice(oldPrefix.length);
              useDocStore.getState().syncNoteMeta(tab.notePath, {
                path: newPath,
                name: tab.title,
                projectSlug: updated.slug
              });
            }
          }
        }
        onNotice(`อัปเดตโปรเจค "${updated.name}" แล้ว`);
      })
      .catch((error: unknown) => {
        window.alert(error instanceof Error ? error.message : 'แก้ไขโปรเจคไม่สำเร็จ');
      });
  };

  const handleDeleteProject = () => {
    const count = project.notes.length;
    const msg =
      count > 0
        ? `ลบโปรเจค "${project.name}" พร้อมโน้ต ${count} รายการถาวร?`
        : `ลบโปรเจค "${project.name}"?`;
    if (!window.confirm(msg)) return;
    const prefix = `projects/${project.slug}/notes/`;
    void removeProject(project.slug).then(() => {
      for (const tab of useDocStore.getState().tabs) {
        if (tab.notePath?.startsWith(prefix)) {
          useDocStore.getState().closeNotePath(tab.notePath);
        }
      }
      onNotice(`ลบโปรเจค "${project.name}" แล้ว`);
    });
  };

  const handleRenameNote = async (note: NoteMeta) => {
    const name = window.prompt('เปลี่ยนชื่อโน้ต:', note.name);
    if (!name?.trim() || name.trim() === note.name) return;
    const updated = await renameNoteAt(note.path, name.trim());
    if (updated) {
      useDocStore.getState().syncNoteMeta(note.path, updated);
    }
  };

  const handleMoveNote = async (note: NoteMeta, targetSlug: string) => {
    setMovingNotePath(null);
    if (!targetSlug) return;
    const moved = await moveNoteTo(note.path, targetSlug);
    if (moved) {
      useDocStore.getState().syncNoteMeta(note.path, moved);
      onNotice(`ย้ายไปโปรเจค "${targetSlug}" แล้ว`);
    }
  };

  const handleDeleteNote = (note: NoteMeta) => {
    if (!window.confirm(`ลบโน้ต "${note.name}"? (ประวัติใน .history ยังคงเก็บไว้)`)) return;
    void removeNote(note.path).then(() => {
      useDocStore.getState().closeNotePath(note.path);
    });
  };

  return (
    <section
      className={`notes-group ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={(event) => {
        if (!isDropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOverProject();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        onDragLeaveProject();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (isDropTarget && draggedNote) void handleMoveNote(draggedNote, project.slug);
        onNoteDragEnd();
      }}
    >
      <div className="notes-group-row">
        <button
          type="button"
          className="notes-group-toggle"
          title={project.repoPath ? `${project.name}\nเชื่อมโฟลเดอร์: ${project.repoPath}` : project.name}
          onClick={() => {
            selectProject(project.slug);
            setCollapsed((prev) => !prev);
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="notes-group-name">
            {project.name}
            {project.repoPath && (
              <span className="project-repo-dot" title={`ผูกกับ ${project.repoPath}`}>
                <FolderGit2 size={12} />
              </span>
            )}
          </span>
          <span className="notes-count">{project.notes.length}</span>
        </button>

        <span className="notes-row-actions">
          <button
            type="button"
            className="notes-action"
            title="โน้ตใหม่ในโปรเจคนี้"
            onClick={() => onCreateNote(project.slug)}
          >
            <Plus size={13} />
          </button>
          <button type="button" className="notes-action" title="แก้ไขชื่อ / ผูกโฟลเดอร์" onClick={handleEditProject}>
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="notes-action"
            title="ซ่อนโปรเจคนี้ (ไฟล์จริงยังอยู่)"
            onClick={() => hidePath(project.path)}
          >
            <EyeOff size={13} />
          </button>
          <button
            type="button"
            className="notes-action danger"
            title="ลบโปรเจค"
            onClick={handleDeleteProject}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {!collapsed &&
        project.notes.map((note) => (
          <div
            key={note.path}
            className={`notes-item ${activeNotePath === note.path ? 'active' : ''}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', note.name);
              onNoteDragStart(note);
            }}
            onDragEnd={onNoteDragEnd}
          >
            <button
              type="button"
              className="notes-item-open"
              onClick={() => onOpenNote(note)}
              title={note.name}
            >
              {note.name}
            </button>
            <span className="notes-row-actions">
              <button
                type="button"
                className="notes-action"
                title="เปลี่ยนชื่อ"
                onClick={() => void handleRenameNote(note)}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className="notes-action"
                title="ย้ายไปโปรเจคอื่น"
                onClick={() => setMovingNotePath(movingNotePath === note.path ? null : note.path)}
              >
                <FolderInput size={13} />
              </button>
              <button
                type="button"
                className="notes-action"
                title="ซ่อนโน้ตนี้ (ไฟล์จริงยังอยู่)"
                onClick={() => hidePath(note.path)}
              >
                <EyeOff size={13} />
              </button>
              <button
                type="button"
                className="notes-action danger"
                title="ลบโน้ต"
                onClick={() => handleDeleteNote(note)}
              >
                <Trash2 size={13} />
              </button>
            </span>

            {movingNotePath === note.path && (
              <select
                className="notes-move-select"
                autoFocus
                defaultValue=""
                onBlur={() => setMovingNotePath(null)}
                onChange={(event) => void handleMoveNote(note, event.target.value)}
              >
                <option value="" disabled>
                  ย้ายไปโปรเจค…
                </option>
                {allProjects
                  .filter((target) => target.slug !== project.slug)
                  .map((target) => (
                    <option key={target.slug} value={target.slug}>
                      {target.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        ))}
    </section>
  );
}
