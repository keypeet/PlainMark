import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FolderInput, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { notesSupported, todayGroupName } from '../lib/noteService';
import type { NoteMeta } from '../lib/noteService';
import { useDocStore } from '../store/docStore';
import { useNotesStore } from '../store/notesStore';

interface NotesSidebarProps {
  onOpenNote: (note: NoteMeta) => void;
  onCreateNote: (groupName?: string) => void;
}

export function NotesSidebar({ onOpenNote, onCreateNote }: NotesSidebarProps) {
  const { groups, loaded, refresh, addGroup, renameNoteAt, renameGroupAt, moveNoteTo, removeNote, removeGroup } =
    useNotesStore();
  const activeNotePath = useDocStore((state) => state.notePath);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [movingNote, setMovingNote] = useState<string | null>(null);
  const [dragNote, setDragNote] = useState<{ note: NoteMeta; fromGroup: string } | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!notesSupported) {
    return (
      <aside className="notes-sidebar">
        <div className="notes-head">โน้ตของฉัน</div>
        <p className="notes-empty">ระบบกลุ่มโน้ตใช้ได้เฉพาะแอปเดสก์ท็อป</p>
      </aside>
    );
  }

  const toggleGroup = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAddGroup = () => {
    const name = window.prompt('ตั้งชื่อกลุ่มใหม่:');
    if (name?.trim()) void addGroup(name);
  };

  const handleRenameGroup = (groupPath: string, current: string) => {
    const name = window.prompt('เปลี่ยนชื่อกลุ่ม:', current);
    if (!name?.trim() || name === current) return;
    renameGroupAt(groupPath, name).catch((error: unknown) => {
      window.alert(error instanceof Error ? error.message : 'เปลี่ยนชื่อกลุ่มไม่สำเร็จ');
    });
  };

  const handleDeleteGroup = (groupPath: string, name: string, noteCount: number) => {
    const message =
      noteCount > 0
        ? `ลบกลุ่ม "${name}" พร้อมโน้ต ${noteCount} รายการ? โน้ตทั้งหมดในกลุ่มจะถูกลบถาวร`
        : `ลบกลุ่ม "${name}"?`;
    if (!window.confirm(message)) return;
    void removeGroup(groupPath).then(() => {
      const { notePath, newDocument } = useDocStore.getState();
      if (notePath?.startsWith(groupPath)) newDocument();
    });
  };

  const handleRenameNote = async (note: NoteMeta) => {
    const name = window.prompt('เปลี่ยนชื่อโน้ต:', note.name);
    if (!name?.trim() || name === note.name) return;
    const renamed = await renameNoteAt(note.path, name);
    if (renamed && useDocStore.getState().notePath === note.path) {
      useDocStore.getState().setNotePath(renamed.path);
      useDocStore.getState().setFile({ path: renamed.path, name: `${renamed.name}.md` });
    }
  };

  const handleMoveNote = async (note: NoteMeta, targetGroup: string) => {
    setMovingNote(null);
    if (!targetGroup) return;
    const moved = await moveNoteTo(note.path, targetGroup);
    if (moved && useDocStore.getState().notePath === note.path) {
      useDocStore.getState().setNotePath(moved.path);
      useDocStore.getState().setFile({ path: moved.path, name: `${moved.name}.md` });
    }
  };

  const handleDeleteNote = (note: NoteMeta) => {
    if (!window.confirm(`ลบโน้ต "${note.name}" ถาวร?`)) return;
    void removeNote(note.path).then(() => {
      if (useDocStore.getState().notePath === note.path) useDocStore.getState().newDocument();
    });
  };

  return (
    <aside className="notes-sidebar">
      <div className="notes-head">
        <span>โน้ตของฉัน</span>
        <div className="notes-head-actions">
          <button className="notes-action" title="โน้ตใหม่ (เข้ากลุ่มวันนี้)" onClick={() => onCreateNote()}>
            <Plus size={15} />
          </button>
          <button className="notes-action" title="สร้างกลุ่มใหม่" onClick={handleAddGroup}>
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      <div className="notes-body">
        {loaded && groups.length === 0 && (
          <p className="notes-empty">
            ยังไม่มีโน้ต — กด + เพื่อสร้างโน้ตแรก
            <br />
            (เก็บใน Documents\PlainMark)
          </p>
        )}

        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.name);
          const isToday = group.name === todayGroupName();
          const isDropTarget = dragNote !== null && dragNote.fromGroup !== group.name;
          return (
            <section
              key={group.path}
              className={`notes-group ${dragOverGroup === group.name ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                if (!isDropTarget) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverGroup(group.name);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragOverGroup((current) => (current === group.name ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (isDropTarget && dragNote) void handleMoveNote(dragNote.note, group.name);
                setDragNote(null);
                setDragOverGroup(null);
              }}
            >
              <div className="notes-group-row">
                <button className="notes-group-toggle" onClick={() => toggleGroup(group.name)}>
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="notes-group-name">
                    {group.name}
                    {isToday && <em className="notes-today-badge">วันนี้</em>}
                  </span>
                  <span className="notes-count">{group.notes.length}</span>
                </button>
                <span className="notes-row-actions">
                  <button className="notes-action" title="โน้ตใหม่ในกลุ่มนี้" onClick={() => onCreateNote(group.name)}>
                    <Plus size={13} />
                  </button>
                  <button
                    className="notes-action"
                    title="เปลี่ยนชื่อกลุ่ม"
                    onClick={() => handleRenameGroup(group.path, group.name)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="notes-action danger"
                    title="ลบกลุ่ม"
                    onClick={() => handleDeleteGroup(group.path, group.name, group.notes.length)}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>

              {!isCollapsed &&
                group.notes.map((note) => (
                  <div
                    key={note.path}
                    className={`notes-item ${activeNotePath === note.path ? 'active' : ''}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', note.name);
                      setDragNote({ note, fromGroup: group.name });
                    }}
                    onDragEnd={() => {
                      setDragNote(null);
                      setDragOverGroup(null);
                    }}
                  >
                    <button className="notes-item-open" onClick={() => onOpenNote(note)} title={note.name}>
                      {note.name}
                    </button>
                    <span className="notes-row-actions">
                      <button className="notes-action" title="เปลี่ยนชื่อ" onClick={() => void handleRenameNote(note)}>
                        <Pencil size={13} />
                      </button>
                      <button
                        className="notes-action"
                        title="ย้ายไปกลุ่มอื่น"
                        onClick={() => setMovingNote(movingNote === note.path ? null : note.path)}
                      >
                        <FolderInput size={13} />
                      </button>
                      <button className="notes-action danger" title="ลบโน้ต" onClick={() => handleDeleteNote(note)}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                    {movingNote === note.path && (
                      <select
                        className="notes-move-select"
                        autoFocus
                        defaultValue=""
                        onBlur={() => setMovingNote(null)}
                        onChange={(event) => void handleMoveNote(note, event.target.value)}
                      >
                        <option value="" disabled>
                          ย้ายไปกลุ่ม…
                        </option>
                        {groups
                          .filter((target) => target.name !== group.name)
                          .map((target) => (
                            <option key={target.path} value={target.name}>
                              {target.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
