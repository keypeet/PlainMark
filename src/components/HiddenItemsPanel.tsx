import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, FileText, Folder } from 'lucide-react';
import type { NoteMeta } from '../lib/noteService';
import { noteExtension, noteGroupName, noteNameFromPath } from '../lib/noteService';
import { baseName } from '../lib/paths';
import { useDocStore } from '../store/docStore';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';

interface HiddenItemsPanelProps {
  onOpenNote: (note: NoteMeta) => void;
}

function stalePathEntry(path: string) {
  const isNote = path.toLowerCase().endsWith(noteExtension);
  return {
    path,
    isNote,
    label: isNote ? noteNameFromPath(path) : baseName(path),
    detail: isNote ? noteGroupName(path) : null
  };
}

export function HiddenItemsPanel({ onOpenNote }: HiddenItemsPanelProps) {
  const hiddenPaths = useSettingsStore((state) => state.hiddenPaths);
  const unhidePath = useSettingsStore((state) => state.unhidePath);
  const { projects, loaded, refresh } = useNotesStore();
  const activeNotePath = useDocStore((state) => state.notePath);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hiddenSet = useMemo(() => new Set(hiddenPaths), [hiddenPaths]);
  const hiddenProjects = useMemo(
    () => projects.filter((project) => hiddenSet.has(project.path)),
    [projects, hiddenSet]
  );

  const hiddenNotes = useMemo(() => {
    const entries: { note: NoteMeta; projectName: string }[] = [];
    for (const project of projects) {
      if (hiddenSet.has(project.path)) continue;
      for (const note of project.notes) {
        if (hiddenSet.has(note.path)) entries.push({ note, projectName: project.name });
      }
    }
    return entries;
  }, [projects, hiddenSet]);

  const stalePaths = useMemo(() => {
    if (!loaded) return [];
    const matched = new Set<string>();
    hiddenProjects.forEach((p) => matched.add(p.path));
    hiddenNotes.forEach(({ note }) => matched.add(note.path));
    return hiddenPaths.filter((path) => !matched.has(path)).map(stalePathEntry);
  }, [loaded, hiddenProjects, hiddenNotes, hiddenPaths]);

  const toggleProject = (path: string) =>
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const isEmpty = hiddenProjects.length === 0 && hiddenNotes.length === 0 && stalePaths.length === 0;

  return (
    <aside className="notes-sidebar">
      <div className="notes-head">
        <span>รายการที่ซ่อน</span>
      </div>
      <div className="notes-body">
        {isEmpty && (
          <p className="notes-empty">
            ยังไม่มีรายการที่ซ่อน
            <br />
            (ซ่อนโน้ต/โปรเจคได้จากปุ่มรูปตาในแถบโปรเจค)
          </p>
        )}

        {hiddenProjects.map((project) => {
          const collapsed = collapsedProjects.has(project.path);
          return (
            <section key={project.path} className="notes-group">
              <div className="notes-group-row">
                <button
                  type="button"
                  className="notes-group-toggle"
                  onClick={() => toggleProject(project.path)}
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="notes-group-name">{project.name}</span>
                  <span className="notes-count">{project.notes.length}</span>
                </button>
                <span className="notes-row-actions">
                  <button
                    type="button"
                    className="notes-action"
                    title="เลิกซ่อนโปรเจคนี้"
                    onClick={() => unhidePath(project.path)}
                  >
                    <Eye size={13} />
                  </button>
                </span>
              </div>
              {!collapsed &&
                project.notes.map((note) => (
                  <div key={note.path} className={`notes-item ${activeNotePath === note.path ? 'active' : ''}`}>
                    <button type="button" className="notes-item-open" onClick={() => onOpenNote(note)}>
                      {note.name}
                    </button>
                  </div>
                ))}
            </section>
          );
        })}

        {hiddenNotes.map(({ note, projectName }) => (
          <div
            key={note.path}
            className={`hidden-item ${activeNotePath === note.path ? 'active' : ''}`}
            title={note.path}
          >
            <FileText size={14} />
            <button
              type="button"
              className="hidden-item-name hidden-item-open"
              onClick={() => onOpenNote(note)}
            >
              {note.name}
              <em className="hidden-item-detail">ใน {projectName}</em>
            </button>
            <button
              type="button"
              className="notes-action"
              title="เลิกซ่อน"
              onClick={() => unhidePath(note.path)}
            >
              <Eye size={14} />
            </button>
          </div>
        ))}

        {stalePaths.length > 0 && (
          <>
            <div className="hidden-section-label">ซ่อนไว้แต่หาไฟล์ไม่เจอแล้ว</div>
            {stalePaths.map((entry) => (
              <div key={entry.path} className="hidden-item" title={entry.path}>
                {entry.isNote ? <FileText size={14} /> : <Folder size={14} />}
                <span className="hidden-item-name">
                  {entry.label}
                  {entry.detail && <em className="hidden-item-detail">ใน {entry.detail}</em>}
                </span>
                <button
                  type="button"
                  className="notes-action"
                  title="ล้างออกจากรายการที่ซ่อน"
                  onClick={() => unhidePath(entry.path)}
                >
                  <Eye size={14} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
