import { useEffect, useState } from 'react';
import { FolderCog, FolderPlus, Plus, RotateCcw } from 'lucide-react';
import { noteGroupName, notesSupported } from '../lib/noteService';
import type { NoteMeta } from '../lib/noteService';
import { useDocStore } from '../store/docStore';
import { useNotesStore } from '../store/notesStore';
import { NotesGroup } from './notes/NotesGroup';
import { useNotesRoot } from './notes/useNotesRoot';

interface NotesSidebarProps {
  onOpenNote: (note: NoteMeta) => void;
  onCreateNote: (groupName?: string) => void;
}

export function NotesSidebar({ onOpenNote, onCreateNote }: NotesSidebarProps) {
  const { groups, loaded, selectedGroup, refresh, addGroup } = useNotesStore();
  const activeNotePath = useDocStore((state) => state.notePath);
  const { rootDir, hasCustomRoot, applyNotesRoot, changeRootViaDialog } = useNotesRoot();
  // สถานะลากวางข้ามกลุ่ม — ต้องอยู่ระดับ sidebar เพราะกลุ่มต้นทาง/ปลายทางเป็นคนละ component
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

  const handleAddGroup = () => {
    const name = window.prompt('ตั้งชื่อกลุ่มใหม่:');
    if (name?.trim()) void addGroup(name);
  };

  const endDrag = () => {
    setDragNote(null);
    setDragOverGroup(null);
  };

  return (
    <aside className="notes-sidebar">
      <div className="notes-head">
        <span>โน้ตของฉัน</span>
        <div className="notes-head-actions">
          <button
            className="notes-action"
            title="โน้ตใหม่ (ในกลุ่มที่เลือกอยู่ — ไม่มี → กลุ่มวันนี้)"
            onClick={() =>
              onCreateNote(selectedGroup ?? ((activeNotePath && noteGroupName(activeNotePath)) || undefined))
            }
          >
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
            (เก็บใน {rootDir || 'Documents\\PlainMark'})
          </p>
        )}

        {groups.map((group) => (
          <NotesGroup
            key={group.path}
            group={group}
            allGroups={groups}
            onOpenNote={onOpenNote}
            onCreateNote={onCreateNote}
            draggedNote={dragNote?.note ?? null}
            isDropTarget={dragNote !== null && dragNote.fromGroup !== group.name}
            isDragOver={dragOverGroup === group.name}
            onNoteDragStart={(note) => setDragNote({ note, fromGroup: group.name })}
            onNoteDragEnd={endDrag}
            onDragOverGroup={() => setDragOverGroup(group.name)}
            onDragLeaveGroup={() => setDragOverGroup((current) => (current === group.name ? null : current))}
          />
        ))}
      </div>

      <div className="notes-foot">
        <button
          className="notes-root"
          title={`โฟลเดอร์เก็บโน้ต:\n${rootDir}\n(คลิกเพื่อเปลี่ยน)`}
          onClick={() => void changeRootViaDialog()}
        >
          <FolderCog size={14} />
          <span className="notes-root-path">{rootDir || '…'}</span>
        </button>
        {hasCustomRoot && (
          <button
            className="notes-action"
            title="กลับไปใช้โฟลเดอร์เริ่มต้น (Documents\PlainMark)"
            onClick={() => void applyNotesRoot(null)}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </aside>
  );
}
