import { useEffect, useMemo, useState } from 'react';
import { FolderArchive, FolderOpen, FolderPlus, Plus, Search } from 'lucide-react';
import type { NoteMeta } from '../lib/noteService';
import { useDocStore } from '../store/docStore';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';
import { NotesGroup } from './notes/NotesGroup';

interface NotesSidebarProps {
  onOpenNote: (note: NoteMeta) => void;
  onCreateNote: (projectSlug?: string) => void;
  onNotice: (message: string) => void;
  width: number;
  onResize: (width: number) => void;
}

export function NotesSidebar({ onOpenNote, onCreateNote, onNotice, width, onResize }: NotesSidebarProps) {
  const {
    projects,
    dataRoot,
    loaded,
    backendOnline,
    legacyAvailable,
    legacyPath,
    selectedProjectSlug,
    refresh,
    addProject,
    importLegacy
  } = useNotesStore();
  const hiddenPaths = useSettingsStore((state) => state.hiddenPaths);
  const activeProjectSlug = useDocStore((state) => state.projectSlug);
  const [filterText, setFilterText] = useState('');
  const [importing, setImporting] = useState(false);

  const [dragNote, setDragNote] = useState<{ note: NoteMeta; fromSlug: string } | null>(null);
  const [dragOverSlug, setDragOverSlug] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleProjects = useMemo(() => {
    const hidden = new Set(hiddenPaths);
    const needle = filterText.trim().toLowerCase();
    return projects
      .filter((project) => !hidden.has(project.path))
      .map((project) => {
        const notes = project.notes.filter((note) => {
          if (hidden.has(note.path)) return false;
          if (!needle) return true;
          return (
            note.name.toLowerCase().includes(needle) ||
            project.name.toLowerCase().includes(needle)
          );
        });
        return { ...project, notes };
      })
      .filter((project) => !needle || project.notes.length > 0 || project.name.toLowerCase().includes(needle));
  }, [projects, hiddenPaths, filterText]);

  const handleAddProject = () => {
    const name = window.prompt('ตั้งชื่อโปรเจคใหม่ (เช่น Self_development, งานประจำ):');
    if (!name?.trim()) return;
    const repoPath = window.prompt('ผูกกับโฟลเดอร์โค้ด/งานเดิม (ไม่บังคับ — เว้นว่างได้):', '');
    void addProject(name.trim(), repoPath?.trim() || null).then((created) => {
      if (created) onNotice(`สร้างโปรเจค "${created.name}" แล้ว`);
    });
  };

  const handleImportLegacy = async () => {
    if (importing) return;
    const ok = window.confirm(
      `คัดลอกโน้ตเดิมจาก:\n${legacyPath}\nมาเป็นโปรเจคใน PlainMark v2?\n(ไฟล์ต้นฉบับเดิมจะไม่ถูกลบหรือแก้ไข)`
    );
    if (!ok) return;
    setImporting(true);
    try {
      const res = await importLegacy();
      if (res) {
        onNotice(`นำเข้าแล้ว ${res.importedNotes} โน้ต (${res.importedProjects} โปรเจคใหม่)`);
      }
    } finally {
      setImporting(false);
    }
  };

  const endDrag = () => {
    setDragNote(null);
    setDragOverSlug(null);
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const resize = (moveEvent: PointerEvent) => onResize(width + moveEvent.clientX - startX);
    const stop = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop);
  };

  return (
    <aside className="notes-sidebar">
      <div className="notes-head">
        <span>โปรเจค</span>
        <div className="notes-head-actions">
          <button
            type="button"
            className="notes-action"
            title="โน้ตใหม่ในโปรเจคที่เลือก (Ctrl+N)"
            onClick={() => onCreateNote(selectedProjectSlug ?? activeProjectSlug ?? undefined)}
          >
            <Plus size={15} />
          </button>
          <button type="button" className="notes-action" title="สร้างโปรเจคใหม่" onClick={handleAddProject}>
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      <div className="sidebar-filter">
        <Search size={13} />
        <input
          type="search"
          placeholder="กรองชื่อโปรเจค / โน้ต…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
      </div>

      <div className="notes-body">
        {!backendOnline && (
          <p className="notes-empty">
            เชื่อมต่อ backend ในเครื่องไม่ได้
            <br />
            กรุณาเปิดผ่าน <code>PlainMark.cmd</code> หรือ <code>start-plainmark.ps1</code>
          </p>
        )}

        {backendOnline && loaded && visibleProjects.length === 0 && (
          <p className="notes-empty">
            {filterText ? `ไม่พบรายการที่ตรงกับ "${filterText}"` : 'ยังไม่มีโปรเจค — กด + เพื่อเริ่มใช้งาน'}
          </p>
        )}

        {visibleProjects.map((project) => (
          <NotesGroup
            key={project.slug}
            project={project}
            allProjects={projects.filter((p) => !hiddenPaths.includes(p.path))}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
            onNotice={onNotice}
            draggedNote={dragNote?.note ?? null}
            isDropTarget={dragNote !== null && dragNote.fromSlug !== project.slug}
            isDragOver={dragOverSlug === project.slug}
            onNoteDragStart={(note) => setDragNote({ note, fromSlug: project.slug })}
            onNoteDragEnd={endDrag}
            onDragOverProject={() => setDragOverSlug(project.slug)}
            onDragLeaveProject={() => setDragOverSlug((cur) => (cur === project.slug ? null : cur))}
          />
        ))}
      </div>

      <div className="notes-foot">
        {legacyAvailable && (
          <button
            type="button"
            className="notes-import-btn"
            disabled={importing}
            title={`คัดลอกโน้ตเดิมจาก ${legacyPath} เข้ามา`}
            onClick={() => void handleImportLegacy()}
          >
            <FolderArchive size={13} />
            <span>{importing ? 'กำลังนำเข้า…' : 'นำเข้าโน้ตเดิม (Documents\\PlainMark)'}</span>
          </button>
        )}
        <div className="notes-root-info" title={`ที่เก็บข้อมูลหลัก:\n${dataRoot}`}>
          <FolderOpen size={13} />
          <span className="notes-root-path">{dataRoot || 'PlainMarkData'}</span>
        </div>
      </div>

      <div className="notes-resize-handle" role="separator" aria-orientation="vertical" onPointerDown={beginResize} />
    </aside>
  );
}
