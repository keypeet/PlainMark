// แผง "รายการที่ซ่อน" — เปิดจากปุ่มรูปตาในแถบกิจกรรมซ้าย ใช้ดูว่าซ่อนอะไรไว้บ้าง และกดยกเลิกซ่อนได้
// การซ่อนแค่เอาออกจากแถบข้าง ไฟล์/โฟลเดอร์จริงบนดิสก์ไม่ถูกแตะต้อง
import { Eye, FileText, Folder } from 'lucide-react';
import { noteExtension, noteGroupName, noteNameFromPath } from '../lib/noteService';
import { baseName } from '../lib/paths';
import { useSettingsStore } from '../store/settingsStore';

interface HiddenEntry {
  path: string;
  isNote: boolean;
  label: string;
  detail: string | null; // โน้ต = ชื่อกลุ่มที่สังกัด, กลุ่ม = ไม่มี
}

function toEntry(path: string): HiddenEntry {
  const isNote = path.toLowerCase().endsWith(noteExtension);
  return {
    path,
    isNote,
    label: isNote ? noteNameFromPath(path) : baseName(path),
    detail: isNote ? noteGroupName(path) : null
  };
}

export function HiddenItemsPanel() {
  const hiddenPaths = useSettingsStore((state) => state.hiddenPaths);
  const unhidePath = useSettingsStore((state) => state.unhidePath);
  const entries = hiddenPaths.map(toEntry);

  return (
    <aside className="notes-sidebar">
      <div className="notes-head">
        <span>รายการที่ซ่อน</span>
      </div>
      <div className="notes-body">
        {entries.length === 0 && (
          <p className="notes-empty">
            ยังไม่มีรายการที่ซ่อน
            <br />
            (ซ่อนโน้ต/กลุ่มได้จากปุ่มรูปตาในแถบ "โน้ตของฉัน")
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.path} className="hidden-item" title={entry.path}>
            {entry.isNote ? <FileText size={14} /> : <Folder size={14} />}
            <span className="hidden-item-name">
              {entry.label}
              {entry.detail && <em className="hidden-item-detail">ในกลุ่ม {entry.detail}</em>}
            </span>
            <button className="notes-action" title="เลิกซ่อน — กลับมาแสดงในแถบข้าง" onClick={() => unhidePath(entry.path)}>
              <Eye size={14} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
