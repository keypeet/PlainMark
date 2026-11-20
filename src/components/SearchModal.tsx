import { FileText, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiSearch } from '../lib/api';
import type { SearchHit } from '../lib/api';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelectHit: (hit: SearchHit) => void;
}

export function SearchModal({ open, onClose, onSelectHit }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void apiSearch(trimmed)
        .then((res) => {
          if (cancelled) return;
          setResults(res.results);
          setSelectedIndex(0);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter' && results[selectedIndex]) {
      event.preventDefault();
      onSelectHit(results[selectedIndex]);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="search-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="search-modal-head">
          <Search size={16} />
          <input
            ref={inputRef}
            className="search-modal-input"
            placeholder="ค้นหาชื่อโน้ตหรือเนื้อหาข้ามทุกโปรเจค (รองรับภาษาไทยและอังกฤษ)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="find-icon-btn" onClick={onClose} aria-label="ปิด">
            <X size={15} />
          </button>
        </div>

        <div className="search-modal-body">
          {!query.trim() && (
            <div className="search-modal-empty">พิมพ์คำที่ต้องการค้นหา แล้วกด Enter เพื่อเปิดในแท็บใหม่</div>
          )}
          {query.trim() && loading && <div className="search-modal-empty">กำลังค้นหา…</div>}
          {query.trim() && !loading && results.length === 0 && (
            <div className="search-modal-empty">ไม่พบโน้ตที่ตรงกับ “{query}”</div>
          )}
          {results.map((hit, idx) => (
            <button
              key={hit.path}
              type="button"
              className={`search-hit ${idx === selectedIndex ? 'active' : ''}`}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => {
                onSelectHit(hit);
                onClose();
              }}
            >
              <div className="search-hit-top">
                <FileText size={14} />
                <strong>{hit.title}</strong>
                <span className="search-hit-project">{hit.projectName}</span>
              </div>
              {hit.snippet && <div className="search-hit-snippet">{hit.snippet}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
