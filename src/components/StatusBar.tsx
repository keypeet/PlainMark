import { useDocStore } from '../store/docStore';
import { useSettingsStore } from '../store/settingsStore';

function countWords(content: string): number {
  return content.trim().match(/\S+/g)?.length ?? 0;
}

export function StatusBar() {
  const { content, dirty, cursor, file, notePath } = useDocStore();
  const zoom = useSettingsStore((state) => state.zoom);
  const setZoom = useSettingsStore((state) => state.setZoom);
  const statusLabel = notePath ? (dirty ? '● กำลังบันทึก…' : '● บันทึกอัตโนมัติแล้ว') : dirty ? '● Unsaved' : '● Saved';

  return (
    <footer className="statusbar">
      <span className={dirty ? 'status-dirty' : 'status-saved'}>{statusLabel}</span>
      <span>UTF-8</span>
      <span>{file.path ? file.path : file.name}</span>
      <div className="status-spacer" />
      <span className="status-zoom">
        <button title="ย่อ (Ctrl+- หรือ Ctrl+ลูกกลิ้ง)" onClick={() => setZoom(zoom - 0.1)}>
          −
        </button>
        <button className="status-zoom-value" title="รีเซ็ตซูม 100% (Ctrl+0)" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button title="ขยาย (Ctrl+= หรือ Ctrl+ลูกกลิ้ง)" onClick={() => setZoom(zoom + 0.1)}>
          +
        </button>
      </span>
      <span>{countWords(content)} words</span>
      <span>{content.length} chars</span>
      <span>
        Ln {cursor.line}, Col {cursor.column}
      </span>
    </footer>
  );
}
