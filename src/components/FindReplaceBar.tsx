import { ArrowDown, ArrowUp, CornerDownLeft, Replace, X } from 'lucide-react';
import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useDocStore } from '../store/docStore';
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
  const content = useDocStore((s) => s.content);
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

  const matchingLines = useMemo(() => {
    const q = query.trim();
    if (!q || (mode !== 'find' && mode !== 'replace')) return [];
    const needle = matchCase ? q : q.toLowerCase();
    const lines = content.split(/\r?\n/);
    const hits: Array<{ line: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const hay = matchCase ? lines[i] : lines[i].toLowerCase();
      if (hay.includes(needle)) {
        hits.push({ line: i + 1, text: lines[i].trim() || '(บรรทัดว่าง)' });
        if (hits.length >= 100) break;
      }
    }
    return hits;
  }, [content, query, matchCase, mode]);

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
      <aside className="find-side-panel" aria-label="ไปที่บรรทัด">
        <div className="find-side-head">
          <span>ไปที่บรรทัด</span>
          <button type="button" className="find-icon-btn" title="ปิด (Esc)" onClick={handleClose}>
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submitGoto} style={{ display: 'flex', gap: 6 }}>
          <input
            ref={gotoInputRef}
            type="number"
            min={1}
            className="find-input"
            style={{ flex: 1 }}
            placeholder="เลขบรรทัด…"
            value={lineInput}
            onChange={(e) => setLineInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && handleClose()}
          />
          <button type="submit" className="find-btn primary" title="กระโดด (Enter)">
            <CornerDownLeft size={14} /> ไป
          </button>
        </form>
      </aside>
    );
  }

  return (
    <aside
      className="find-side-panel"
      aria-label="ค้นหาและแทนที่ในโน้ต"
      onKeyDown={(e) => e.key === 'Escape' && handleClose()}
    >
      <div className="find-side-head">
        <span>ค้นหาในโน้ต</span>
        <button type="button" className="find-icon-btn" title="ปิด (Esc)" onClick={handleClose}>
          <X size={14} />
        </button>
      </div>

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
      </div>

      <div className="find-row">
        <span className="find-count">{query ? `${stats.current} / ${stats.total}` : '0 จุด'}</span>
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
      </div>

      {mode === 'replace' && (
        <>
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
          </div>
          <div className="find-row">
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
        </>
      )}

      {query.trim() && (
        <div className="find-matches-list">
          {matchingLines.map((hit) => (
            <button
              key={hit.line}
              type="button"
              className="find-match-row"
              onClick={() => editorRef.current?.goToLine(hit.line)}
            >
              <span className="find-match-line">L{hit.line}</span>
              <span className="find-match-text">{hit.text}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
