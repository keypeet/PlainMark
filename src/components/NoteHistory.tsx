// ปุ่ม "ประวัติ" บนหัว Editor — ดูรายการ snapshot ของโน้ตปัจจุบัน แล้วกู้คืนทั้งโน้ตกลับเป็นเวอร์ชันเก่าได้
// snapshot ถูกเก็บอัตโนมัติจากรอบ autosave (ดู noteService) เนื้อหาปัจจุบันจะถูกเก็บเข้าประวัติก่อนกู้คืนเสมอ
import { History } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pad2 } from '../lib/dateFormat';
import { listSnapshots, readSnapshot, saveSnapshot, writeNoteQueued } from '../lib/noteService';
import type { SnapshotMeta } from '../lib/noteService';
import { useDocStore } from '../store/docStore';
import { useSettingsStore } from '../store/settingsStore';

function snapshotLabel(savedAt: number): string {
  const date = new Date(savedAt);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function NoteHistory() {
  const notePath = useDocStore((state) => state.notePath);
  const historyIntervalMin = useSettingsStore((state) => state.historyIntervalMin);
  const historyKeep = useSettingsStore((state) => state.historyKeep);
  const setHistoryIntervalMin = useSettingsStore((state) => state.setHistoryIntervalMin);
  const setHistoryKeep = useSettingsStore((state) => state.setHistoryKeep);
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  // เวอร์ชันที่กำลังเปิดดูเนื้อหา (คลิกเวลาเพื่อดูก่อนตัดสินใจกู้คืน)
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(() => {
    if (!notePath) return;
    void listSnapshots(notePath)
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [notePath]);

  // โหลดรายการตั้งแต่เปลี่ยนโน้ต — ให้ tooltip บอกจำนวนเวอร์ชันได้โดยไม่ต้องเปิดแผงก่อน
  useEffect(() => {
    setOpen(false);
    setPreview(null);
    setSnapshots([]);
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (open) refreshList();
    else setPreview(null);
  }, [open, refreshList]);

  // ปิดแผงเมื่อคลิกที่อื่น
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const togglePreview = async (snapshot: SnapshotMeta) => {
    if (preview?.path === snapshot.path) {
      setPreview(null);
      return;
    }
    try {
      setPreview({ path: snapshot.path, content: await readSnapshot(snapshot.path) });
    } catch {
      setPreview(null);
    }
  };

  const restore = useCallback(
    async (snapshot: SnapshotMeta) => {
      if (!notePath) return;
      const ok = window.confirm(
        `กู้คืนโน้ตกลับเป็นเวอร์ชัน ${snapshotLabel(snapshot.savedAt)}?\n(เนื้อหาปัจจุบันจะถูกเก็บเข้าประวัติให้ก่อน ไม่หายแน่นอน)`
      );
      if (!ok) return;
      try {
        const restored = await readSnapshot(snapshot.path);
        await saveSnapshot(notePath, useDocStore.getState().content); // กันเนื้อหาปัจจุบันหาย
        useDocStore.getState().setContent(restored);
        await writeNoteQueued(notePath, restored);
        setOpen(false);
      } catch (error) {
        console.error('PlainMark: restore snapshot failed', error);
        window.alert('กู้คืนเวอร์ชันไม่สำเร็จ');
      }
    },
    [notePath]
  );

  if (!notePath) return null;

  const statusLine = `เก็บอัตโนมัติทุก ${historyIntervalMin} นาทีระหว่างแก้ไข • ตอนนี้มี ${snapshots.length} เวอร์ชัน (สูงสุด ${historyKeep})`;

  return (
    <div className="note-history" ref={panelRef}>
      <button
        className="history-button"
        title={`ประวัติเวอร์ชันของโน้ตนี้\n${statusLine}`}
        onMouseEnter={refreshList}
        onClick={() => setOpen((value) => !value)}
      >
        <History size={13} /> ประวัติ
      </button>
      {open && (
        <div className="history-panel">
          <div className="history-title">{statusLine}</div>
          <div className="history-settings">
            <label>
              เก็บทุก
              <input
                type="number"
                min={1}
                max={120}
                value={historyIntervalMin}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (!Number.isNaN(value)) setHistoryIntervalMin(value);
                }}
              />
              นาที
            </label>
            <label>
              สูงสุด
              <input
                type="number"
                min={1}
                max={100}
                value={historyKeep}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (!Number.isNaN(value)) setHistoryKeep(value);
                }}
              />
              เวอร์ชัน
            </label>
          </div>
          {snapshots.length === 0 && (
            <div className="history-empty">ยังไม่มีเวอร์ชันเก่า — จะเริ่มเก็บเมื่อโน้ตถูกแก้ไขต่อเนื่อง</div>
          )}
          {snapshots.map((snapshot) => (
            <div key={snapshot.path}>
              <div className="history-row">
                <button
                  className={`history-time ${preview?.path === snapshot.path ? 'active' : ''}`}
                  title="คลิกเพื่อดูเนื้อหาเวอร์ชันนี้"
                  onClick={() => void togglePreview(snapshot)}
                >
                  {snapshotLabel(snapshot.savedAt)}
                </button>
                <button className="history-restore" onClick={() => void restore(snapshot)}>
                  กู้คืน
                </button>
              </div>
              {preview?.path === snapshot.path && <pre className="history-preview">{preview.content}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
