import { useDocStore } from '../store/docStore';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';

function countWords(content: string): number {
  return content.trim().match(/\S+/g)?.length ?? 0;
}

interface StatusBarProps {
  onClickGoToLine: () => void;
}

export function StatusBar({ onClickGoToLine }: StatusBarProps) {
  const { content, dirty, cursor, notePath, projectSlug, lineEnding, setLineEnding } = useDocStore();
  const backendOnline = useNotesStore((state) => state.backendOnline);
  const { zoom, setZoom, viewMode, toggleViewMode } = useSettingsStore();

  const statusLabel = !backendOnline
    ? '● Backend offline'
    : notePath
      ? dirty
        ? '● กำลังบันทึก…'
        : '● บันทึกแล้ว'
      : dirty
        ? '● Draft (Ghost)'
        : '● Draft';

  return (
    <footer className="statusbar">
      <span className={!backendOnline || dirty ? 'status-dirty' : 'status-saved'}>{statusLabel}</span>
      {projectSlug && <span className="status-project">{projectSlug}</span>}

      <button type="button" className="status-btn" title="คลิกเพื่อไปที่บรรทัด (Ctrl+G)" onClick={onClickGoToLine}>
        Ln {cursor.line}, Col {cursor.column}
      </button>

      <span>
        {countWords(content)} words · {content.length} chars
      </span>

      <div className="status-spacer" />

      <button
        type="button"
        className="status-btn"
        title="สลับมุมมอง Formatted ⇄ Markdown Syntax (Ctrl+Shift+M)"
        onClick={toggleViewMode}
      >
        {viewMode === 'formatted' ? 'AA Formatted' : '</> Markdown syntax'}
      </button>

      <span className="status-zoom">
        <button type="button" title="ย่อ (Ctrl+-)" onClick={() => setZoom(zoom - 0.1)}>
          −
        </button>
        <button type="button" className="status-zoom-value" title="รีเซ็ตซูม 100% (Ctrl+0)" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="status-zoom-value-plus" title="ขยาย (Ctrl+=)" onClick={() => setZoom(zoom + 0.1)}>
          +
        </button>
      </span>

      <button
        type="button"
        className="status-btn"
        title="คลิกเพื่อสลับตัวขึ้นบรรทัด LF / CRLF"
        onClick={() => setLineEnding(lineEnding === 'LF' ? 'CRLF' : 'LF')}
      >
        {lineEnding === 'LF' ? 'Unix (LF)' : 'Windows (CRLF)'}
      </button>

      <span>UTF-8</span>
    </footer>
  );
}
