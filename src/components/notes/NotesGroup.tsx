import { useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, FolderInput, Pencil, Plus, Trash2 } from 'lucide-react';
import type { GroupMeta, NoteMeta } from '../../lib/noteService';
import { noteGroupName, todayGroupName } from '../../lib/noteService';
import { useDocStore } from '../../store/docStore';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';

interface NotesGroupProps {
  group: GroupMeta;
  allGroups: GroupMeta[]; // ตัวเลือกปลายทางตอนย้ายโน้ต
  onOpenNote: (note: NoteMeta) => void;
  onCreateNote: (groupName: string) => void;
  // สถานะลากวางอยู่ที่ NotesSidebar เพราะการลากข้ามกลุ่มต้องเห็นภาพรวมทุกกลุ่ม
  draggedNote: NoteMeta | null;
  isDropTarget: boolean;
  isDragOver: boolean;
  onNoteDragStart: (note: NoteMeta) => void;
  onNoteDragEnd: () => void;
  onDragOverGroup: () => void;
  onDragLeaveGroup: () => void;
}

// อัปเดตเอกสารที่เปิดอยู่ให้ชี้ path ใหม่ หลังโน้ตถูกเปลี่ยนชื่อ/ย้ายไฟล์
function syncOpenDoc(oldPath: string, updated: NoteMeta | null) {
  if (!updated || useDocStore.getState().notePath !== oldPath) return;
  useDocStore.getState().setNotePath(updated.path);
  useDocStore.getState().setFile({ path: updated.path, name: `${updated.name}.md` });
}

export function NotesGroup({
  group,
  allGroups,
  onOpenNote,
  onCreateNote,
  draggedNote,
  isDropTarget,
  isDragOver,
  onNoteDragStart,
  onNoteDragEnd,
  onDragOverGroup,
  onDragLeaveGroup
}: NotesGroupProps) {
  const { selectedGroup, selectGroup, renameNoteAt, renameGroupAt, moveNoteTo, removeNote, removeGroup } =
    useNotesStore();
  const hidePath = useSettingsStore((state) => state.hidePath);
  const activeNotePath = useDocStore((state) => state.notePath);
  const [collapsed, setCollapsed] = useState(false);
  const [movingNotePath, setMovingNotePath] = useState<string | null>(null);

  const isToday = group.name === todayGroupName();
  // เปิดโน้ตในกลุ่มใด ให้กลุ่มนั้นเป็น active เสมอ ไม่ค้างสีจากกลุ่มที่เคยคลิกก่อนหน้า
  const displaySelectedGroup = activeNotePath ? noteGroupName(activeNotePath) === group.name : selectedGroup === group.name;

  const handleRenameGroup = () => {
    const name = window.prompt('เปลี่ยนชื่อกลุ่ม:', group.name);
    if (!name?.trim() || name === group.name) return;
    renameGroupAt(group.path, name).catch((error: unknown) => {
      window.alert(error instanceof Error ? error.message : 'เปลี่ยนชื่อกลุ่มไม่สำเร็จ');
    });
  };

  const handleDeleteGroup = () => {
    const noteCount = group.notes.length;
    const message =
      noteCount > 0
        ? `ลบกลุ่ม "${group.name}" พร้อมโน้ต ${noteCount} รายการ? โน้ตทั้งหมดในกลุ่มจะถูกลบถาวร`
        : `ลบกลุ่ม "${group.name}"?`;
    if (!window.confirm(message)) return;
    void removeGroup(group.path).then(() => {
      const { notePath, newDocument } = useDocStore.getState();
      if (notePath?.startsWith(group.path)) newDocument();
    });
  };

  const handleRenameNote = async (note: NoteMeta) => {
    const name = window.prompt('เปลี่ยนชื่อโน้ต:', note.name);
    if (!name?.trim() || name === note.name) return;
    syncOpenDoc(note.path, await renameNoteAt(note.path, name));
  };

  const handleMoveNote = async (note: NoteMeta, targetGroup: string) => {
    setMovingNotePath(null);
    if (!targetGroup) return;
    syncOpenDoc(note.path, await moveNoteTo(note.path, targetGroup));
  };

  const handleDeleteNote = (note: NoteMeta) => {
    if (!window.confirm(`ลบโน้ต "${note.name}" ถาวร?`)) return;
    void removeNote(note.path).then(() => {
      if (useDocStore.getState().notePath === note.path) useDocStore.getState().newDocument();
    });
  };

  return (
    <section
      className={`notes-group ${displaySelectedGroup ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={(event) => {
        if (!isDropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOverGroup();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        onDragLeaveGroup();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (isDropTarget && draggedNote) void handleMoveNote(draggedNote, group.name);
        onNoteDragEnd();
      }}
    >
      <div className="notes-group-row">
        <button
          className="notes-group-toggle"
          title="คลิกเพื่อเลือกกลุ่มนี้ (ปุ่ม New จะสร้างโน้ตเข้ากลุ่มที่เลือก)"
          onClick={() => {
            selectGroup(group.name);
            setCollapsed((prev) => !prev);
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
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
          <button className="notes-action" title="เปลี่ยนชื่อกลุ่ม" onClick={handleRenameGroup}>
            <Pencil size={13} />
          </button>
          <button
            className="notes-action"
            title="ซ่อนกลุ่มนี้ (ไฟล์ยังอยู่ — ดู/ยกเลิกได้จากปุ่มรายการที่ซ่อน)"
            onClick={() => hidePath(group.path)}
          >
            <EyeOff size={13} />
          </button>
          <button className="notes-action danger" title="ลบกลุ่ม" onClick={handleDeleteGroup}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {!collapsed &&
        group.notes.map((note) => (
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
                onClick={() => setMovingNotePath(movingNotePath === note.path ? null : note.path)}
              >
                <FolderInput size={13} />
              </button>
              <button
                className="notes-action"
                title="ซ่อนโน้ตนี้ (ไฟล์ยังอยู่ — ดู/ยกเลิกได้จากปุ่มรายการที่ซ่อน)"
                onClick={() => hidePath(note.path)}
              >
                <EyeOff size={13} />
              </button>
              <button className="notes-action danger" title="ลบโน้ต" onClick={() => handleDeleteNote(note)}>
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
                  ย้ายไปกลุ่ม…
                </option>
                {allGroups
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
}
