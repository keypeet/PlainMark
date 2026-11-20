import { ArrowDown, ArrowUp, CornerDownLeft, Replace, X } from 'lucide-react';
import { RefObject, useEffect, useRef, useState } from 'react';
import type { EditorApi, SearchStats } from '../types';

export type FindBarMode = 'find' | 'replace' | 'goto' | null;

interface FindReplaceBarProps {
  mode: FindBarMode;
  editorRef: RefObject<EditorApi>;
  onClose: () => void;
  onModeChange: (mode: FindBarMode) => void;
  onNotice: (msg: string) => void;
}

export function FindReplaceBar({ mode, editorRef, onClose, onModeChange, onNotice }: FindReplaceBarProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [lineInput, setLineInput] = useState('');
  const [stats, setStats] = useState<SearchStats>({ total: 0, current: 0 });
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const gotoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode === 'find' || mode === 'replace') {
      requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    } else if (mode === 'goto') {
      requestAnimationFrame(() => {
        gotoInputRef.current?.focus();
        gotoInputRef.current?.select();
      });
    } else {
      editorRef.current?.setSearch('', false);
      setStats({ total: 0, current: 0 });
    }
  }, [mode, editorRef]);

  useEffect(() => {
    if (mode !== 'find' && mode !== 'replace') return;
    const next = editorRef.current?.setSearch(query, matchCase) ?? { total: 0, current: 0 };
    setStats(next);
  }, [query, matchCase, mode, editorRef]);

  if (!mode) return null;

  const handleClose = () => {
    editorRef.current?.setSearch('', false);
    onClose();
    editorRef.current?.focus();
  };

  if (mode === 'goto') {
    const submitGoto = (e: React.FormEvent) => {
      e.preventDefault();
      const num = Number(lineInput.trim());
      if (editorRef.current?.goToLine(num)) {
        onClose();
      } else {
        onNotice('ไม่พบเลขบรรทัดนี้ในเอกสาร');
      }
    };
    return (
      <form className="find-bar goto-bar" onSubmit={submitGoto}>
        <span className="find-label">ไปที่บรรทัด</span>
        <input
          ref={gotoInputRef}
          type="number"
          min={1}
          className="find-input"
          placeholder="เลขบรรทัด…"
          value={lineInput}
          onChange={(e) => setLineInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && handleClose()}
        />
        <button type="submit" className="find-btn primary" title="กระโดด (Enter)">
          <CornerDownLeft size={14} /> ไป
        </button>
        <button type="button" className="find-icon-btn" title="ปิด (Esc)" onClick={handleClose}>
          <X size={14} />
        </button>
      </form>
    );
  }

  return (
    <div className="find-bar" onKeyDown={(e) => e.key === 'Escape' && handleClose()}>
      <div className="find-row">
        <input
          ref={findInputRef}
          className="find-input"
          placeholder="ค้นหาในโน้ต…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const next = e.shiftKey ? editorRef.current?.findPrev() : editorRef.current?.findNext();
              if (next) setStats(next);
            }
          }}
        />
        <span className="find-count">{query ? `${stats.current} / ${stats.total}` : ''}</span>
        <button
          type="button"
          className={`find-icon-btn ${matchCase ? 'active' : ''}`}
          title="ตรงตามตัวพิมพ์ใหญ่-เล็ก (Match Case)"
          onClick={() => setMatchCase((v) => !v)}
        >
          Aa
        </button>
        <button
          type="button"
          className="find-icon-btn"
          title="ก่อนหน้า (Shift+Enter)"
          onClick={() => {
            const next = editorRef.current?.findPrev();
            if (next) setStats(next);
          }}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className="find-icon-btn"
          title="ถัดไป (Enter)"
          onClick={() => {
            const next = editorRef.current?.findNext();
            if (next) setStats(next);
          }}
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          className={`find-icon-btn ${mode === 'replace' ? 'active' : ''}`}
          title="แทนที่ (Ctrl+H)"
          onClick={() => onModeChange(mode === 'replace' ? 'find' : 'replace')}
        >
          <Replace size={14} />
        </button>
        <button type="button" className="find-icon-btn" title="ปิด (Esc)" onClick={handleClose}>
          <X size={14} />
        </button>
      </div>

      {mode === 'replace' && (
        <div className="find-row">
          <input
            className="find-input"
            placeholder="แทนที่ด้วย…"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const next = editorRef.current?.replaceCurrent(replacement);
                if (next) setStats(next);
              }
            }}
          />
          <button
            type="button"
            className="find-btn"
            onClick={() => {
              const next = editorRef.current?.replaceCurrent(replacement);
              if (next) setStats(next);
            }}
          >
            แทนที่
          </button>
          <button
            type="button"
            className="find-btn"
            onClick={() => {
              const count = editorRef.current?.replaceAll(replacement) ?? 0;
              setStats({ total: 0, current: 0 });
              onNotice(`แทนที่แล้ว ${count} จุด`);
            }}
          >
            ทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}
