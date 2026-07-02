import { useDocStore } from '../store/docStore';

function countWords(content: string): number {
  return content.trim().match(/\S+/g)?.length ?? 0;
}

export function StatusBar() {
  const { content, dirty, cursor, file, notePath } = useDocStore();
  const statusLabel = notePath ? (dirty ? '● กำลังบันทึก…' : '● บันทึกอัตโนมัติแล้ว') : dirty ? '● Unsaved' : '● Saved';

  return (
    <footer className="statusbar">
      <span className={dirty ? 'status-dirty' : 'status-saved'}>{statusLabel}</span>
      <span>UTF-8</span>
      <span>{file.path ? file.path : file.name}</span>
      <div className="status-spacer" />
      <span>{countWords(content)} words</span>
      <span>{content.length} chars</span>
      <span>
        Ln {cursor.line}, Col {cursor.column}
      </span>
    </footer>
  );
}
