// แผง "รายการที่ซ่อน" — เปิดจากปุ่มรูปตาในแถบกิจกรรมซ้าย ใช้ดูว่าซ่อนอะไรไว้บ้าง และกดยกเลิกซ่อนได้
// การซ่อนแค่เอาออกจากแถบข้าง ไฟล์/โฟลเดอร์จริงบนดิสก์ไม่ถูกแตะต้อง
// กลุ่มที่ซ่อนไว้ดูรายละเอียดโน้ตข้างในได้เหมือนแถบ "โน้ตของฉัน" และเปิดดูเนื้อหาโน้ตที่ซ่อนได้เลยโดยไม่ต้องเลิกซ่อนก่อน
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

// path ที่ซ่อนไว้แต่หาไฟล์/โฟลเดอร์จริงไม่เจอแล้ว (ถูกลบไปโดยไม่ได้เลิกซ่อนก่อน) — โชว์แบบเดิมไว้ให้ล้างออกจากรายการได้
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
  const { groups, loaded, refresh } = useNotesStore();
  const activeNotePath = useDocStore((state) => state.notePath);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // เผื่อผู้ใช้เปิดแผงนี้เป็นแผงแรกโดยไม่เคยเปิด "โน้ตของฉัน" มาก่อน — ต้องโหลดต้นไม้โน้ตเองเช่นกัน
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hiddenSet = useMemo(() => new Set(hiddenPaths), [hiddenPaths]);
  const hiddenGroups = useMemo(() => groups.filter((group) => hiddenSet.has(group.path)), [groups, hiddenSet]);

  // โน้ตที่ถูกซ่อนเป็นรายตัว (กลุ่มแม่ยังไม่ถูกซ่อน — ถ้ากลุ่มถูกซ่อนไปด้วย รายการโน้ตจะโผล่ใต้กลุ่มนั้นแทน ไม่ซ้ำ)
  const hiddenNotes = useMemo(() => {
    const entries: { note: NoteMeta; groupName: string }[] = [];
    for (const group of groups) {
      if (hiddenSet.has(group.path)) continue;
      for (const note of group.notes) {
        if (hiddenSet.has(note.path)) entries.push({ note, groupName: group.name });
      }
    }
    return entries;
  }, [groups, hiddenSet]);

  // path ที่ซ่อนไว้แต่ไม่เจอในต้นไม้โน้ตปัจจุบันแล้ว (ไฟล์/โฟลเดอร์ถูกลบไปโดยไม่ได้เลิกซ่อนก่อน)
  const stalePaths = useMemo(() => {
    if (!loaded) return [];
    const matched = new Set<string>();
    hiddenGroups.forEach((group) => matched.add(group.path));
    hiddenNotes.forEach(({ note }) => matched.add(note.path));
    return hiddenPaths.filter((path) => !matched.has(path)).map(stalePathEntry);
  }, [loaded, hiddenGroups, hiddenNotes, hiddenPaths]);

  const toggleGroup = (path: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const isEmpty = hiddenGroups.length === 0 && hiddenNotes.length === 0 && stalePaths.length === 0;

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
            (ซ่อนโน้ต/กลุ่มได้จากปุ่มรูปตาในแถบ "โน้ตของฉัน")
          </p>
        )}

        {hiddenGroups.map((group) => {
          const collapsed = collapsedGroups.has(group.path);
          return (
            <section key={group.path} className="notes-group">
              <div className="notes-group-row">
                <button
                  className="notes-group-toggle"
                  title="คลิกเพื่อดู/ซ่อนรายการโน้ตในกลุ่มนี้"
                  onClick={() => toggleGroup(group.path)}
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="notes-group-name">{group.name}</span>
                  <span className="notes-count">{group.notes.length}</span>
                </button>
                <span className="notes-row-actions">
                  <button
                    className="notes-action"
                    title="เลิกซ่อนกลุ่มนี้ — กลับมาแสดงในแถบ &quot;โน้ตของฉัน&quot;"
                    onClick={() => unhidePath(group.path)}
                  >
                    <Eye size={13} />
                  </button>
                </span>
              </div>
              {!collapsed &&
                group.notes.map((note) => (
                  <div key={note.path} className={`notes-item ${activeNotePath === note.path ? 'active' : ''}`}>
                    <button
                      className="notes-item-open"
                      title={`ดูเนื้อหา (ไม่เลิกซ่อน): ${note.name}`}
                      onClick={() => onOpenNote(note)}
                    >
                      {note.name}
                    </button>
                  </div>
                ))}
            </section>
          );
        })}

        {hiddenNotes.map(({ note, groupName }) => (
          <div key={note.path} className={`hidden-item ${activeNotePath === note.path ? 'active' : ''}`} title={note.path}>
            <FileText size={14} />
            <button
              className="hidden-item-name hidden-item-open"
              title={`ดูเนื้อหา (ไม่เลิกซ่อน): ${note.name}`}
              onClick={() => onOpenNote(note)}
            >
              {note.name}
              <em className="hidden-item-detail">ในกลุ่ม {groupName}</em>
            </button>
            <button className="notes-action" title="เลิกซ่อน — กลับมาแสดงในแถบข้าง" onClick={() => unhidePath(note.path)}>
              <Eye size={14} />
            </button>
          </div>
        ))}

        {stalePaths.length > 0 && (
          <>
            <div className="hidden-section-label">ซ่อนไว้แต่หาไฟล์ไม่เจอแล้ว (อาจถูกลบไปแล้ว)</div>
            {stalePaths.map((entry) => (
              <div key={entry.path} className="hidden-item" title={entry.path}>
                {entry.isNote ? <FileText size={14} /> : <Folder size={14} />}
                <span className="hidden-item-name">
                  {entry.label}
                  {entry.detail && <em className="hidden-item-detail">ในกลุ่ม {entry.detail}</em>}
                </span>
                <button className="notes-action" title="ล้างออกจากรายการที่ซ่อน" onClick={() => unhidePath(entry.path)}>
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
