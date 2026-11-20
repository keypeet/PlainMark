import {
  Bold,
  ChevronDown,
  Code,
  Eraser,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Search,
  Strikethrough,
  Table2,
  Terminal,
  WrapText
} from 'lucide-react';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  clearFormatting,
  createCodeBlock,
  createImage,
  createLink,
  createTable,
  prefixLines,
  prefixOrderedList,
  setHeadingLevel,
  wrapSelection
} from '../lib/formatActions';
import { fixTableBlock } from '../lib/tableFormat';
import { useDocStore } from '../store/docStore';
import { useSettingsStore } from '../store/settingsStore';
import type { EditorApi, FormatResult } from '../types';
import { NoteHistory } from './NoteHistory';

type MenuKind = 'heading' | 'list' | 'table' | null;

interface FormatToolbarProps {
  editorRef: RefObject<EditorApi>;
  onOpenFind: () => void;
  onOpenGlobalSearch: () => void;
}

const headingItems = [
  { level: 1, label: 'Title (H1)' },
  { level: 2, label: 'Heading (H2)' },
  { level: 3, label: 'Subheading (H3)' },
  { level: 4, label: 'Section (H4)' },
  { level: 0, label: 'Body (ปกติ)' }
];

export function FormatToolbar({ editorRef, onOpenFind, onOpenGlobalSearch }: FormatToolbarProps) {
  const content = useDocStore((state) => state.content);
  const { viewMode, toggleViewMode, wordWrap, toggleWordWrap } = useSettingsStore();
  const [openMenu, setOpenMenu] = useState<MenuKind>(null);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const barRef = useRef<HTMLDivElement | null>(null);

  const applyResult = useCallback(
    (result: FormatResult | null) => {
      const editor = editorRef.current;
      if (!editor || !result) return;
      editor.replaceContent(result.content, result.selectionStart, result.selectionEnd);
      editor.focus();
    },
    [editorRef]
  );

  const runAction = useCallback(
    (action: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const sel = editor.getSelection();
      const latestContent = useDocStore.getState().content;

      switch (action) {
        case 'bold':
          applyResult(wrapSelection(latestContent, sel, '**', '**', 'bold text'));
          break;
        case 'italic':
          applyResult(wrapSelection(latestContent, sel, '*', '*', 'italic text'));
          break;
        case 'strike':
          applyResult(wrapSelection(latestContent, sel, '~~', '~~', 'text'));
          break;
        case 'code':
          applyResult(wrapSelection(latestContent, sel, '`', '`', 'code'));
          break;
        case 'bullet':
          applyResult(prefixLines(latestContent, sel, '- '));
          break;
        case 'ordered':
          applyResult(prefixOrderedList(latestContent, sel));
          break;
        case 'task':
          applyResult(prefixLines(latestContent, sel, '- [ ] '));
          break;
        case 'quote':
          applyResult(prefixLines(latestContent, sel, '> '));
          break;
        case 'codeblock':
          applyResult(createCodeBlock(latestContent, sel));
          break;
        case 'clear':
          applyResult(clearFormatting(latestContent, sel));
          break;
        case 'link': {
          const url = window.prompt('วางลิงก์ (URL):', 'https://');
          if (!url || url === 'https://') return;
          applyResult(createLink(latestContent, sel, url.trim()));
          break;
        }
        case 'image': {
          const url = window.prompt('วางลิงก์รูปภาพ (URL หรือ path):', '');
          if (!url) return;
          applyResult(createImage(latestContent, sel, url.trim()));
          break;
        }
        case 'table-fix-or-insert': {
          const fixed = fixTableBlock(latestContent, sel);
          if (fixed) {
            applyResult(fixed);
          } else {
            applyResult(createTable(latestContent, sel, tableRows, tableCols));
            editor.focusTableCellAt(sel.from + 1);
          }
          break;
        }
      }
    },
    [applyResult, editorRef, tableCols, tableRows]
  );

  // Formatting keyboard shortcuts (matching Windows Notepad + Markdown norms)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      if (key === ' ' && !event.shiftKey) {
        event.preventDefault();
        runAction('clear');
      } else if (key === 'b' && !event.shiftKey) {
        event.preventDefault();
        runAction('bold');
      } else if (key === 'i' && !event.shiftKey) {
        event.preventDefault();
        runAction('italic');
      } else if (key === 'x' && event.shiftKey) {
        event.preventDefault();
        runAction('strike');
      } else if (key === 'e' && !event.shiftKey) {
        event.preventDefault();
        runAction('code');
      } else if (key === 'k' && !event.shiftKey) {
        event.preventDefault();
        runAction('link');
      } else if (key === 't' && event.shiftKey) {
        event.preventDefault();
        runAction('table-fix-or-insert');
      } else if (key === 'l' && event.shiftKey) {
        event.preventDefault();
        runAction('bullet');
      } else if (key === 'q' && event.shiftKey) {
        event.preventDefault();
        runAction('quote');
      } else if (key === '1' && !event.shiftKey) {
        event.preventDefault();
        const editor = editorRef.current;
        if (editor) applyResult(setHeadingLevel(useDocStore.getState().content, editor.getSelection(), 1));
      } else if (key === '2' && !event.shiftKey) {
        event.preventDefault();
        const editor = editorRef.current;
        if (editor) applyResult(setHeadingLevel(useDocStore.getState().content, editor.getSelection(), 2));
      } else if (key === '3' && !event.shiftKey) {
        event.preventDefault();
        const editor = editorRef.current;
        if (editor) applyResult(setHeadingLevel(useDocStore.getState().content, editor.getSelection(), 3));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [applyResult, editorRef, runAction]);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [openMenu]);

  const handleTableButton = () => {
    const editor = editorRef.current;
    if (editor) {
      const fixed = fixTableBlock(content, editor.getSelection());
      if (fixed) {
        applyResult(fixed);
        setOpenMenu(null);
        return;
      }
    }
    setOpenMenu((prev) => (prev === 'table' ? null : 'table'));
  };

  return (
    <div className="format-bar" ref={barRef} role="toolbar" aria-label="Formatting toolbar">
      {/* Heading dropdown */}
      <div className="fmt-menu-wrap">
        <button
          type="button"
          className={`fmt-btn fmt-dropdown ${openMenu === 'heading' ? 'active' : ''}`}
          title="ระดับหัวข้อ (Ctrl+1/2/3)"
          onClick={() => setOpenMenu((m) => (m === 'heading' ? null : 'heading'))}
        >
          <span>H</span>
          <ChevronDown size={12} />
        </button>
        {openMenu === 'heading' && (
          <div className="fmt-popover">
            {headingItems.map((item) => (
              <button
                key={item.level}
                type="button"
                className="fmt-popover-item"
                onClick={() => {
                  const editor = editorRef.current;
                  if (editor) applyResult(setHeadingLevel(content, editor.getSelection(), item.level));
                  setOpenMenu(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List dropdown */}
      <div className="fmt-menu-wrap">
        <button
          type="button"
          className={`fmt-btn fmt-dropdown ${openMenu === 'list' ? 'active' : ''}`}
          title="รายการ (Bullet / Numbered / Checklist)"
          onClick={() => setOpenMenu((m) => (m === 'list' ? null : 'list'))}
        >
          <List size={15} />
          <ChevronDown size={12} />
        </button>
        {openMenu === 'list' && (
          <div className="fmt-popover">
            <button
              type="button"
              className="fmt-popover-item"
              onClick={() => {
                runAction('bullet');
                setOpenMenu(null);
              }}
            >
              <List size={14} /> จุดวงกลม (- )
            </button>
            <button
              type="button"
              className="fmt-popover-item"
              onClick={() => {
                runAction('ordered');
                setOpenMenu(null);
              }}
            >
              <ListOrdered size={14} /> ตัวเลข (1. )
            </button>
            <button
              type="button"
              className="fmt-popover-item"
              onClick={() => {
                runAction('task');
                setOpenMenu(null);
              }}
            >
              <ListChecks size={14} /> เช็คลิสต์ (- [ ])
            </button>
          </div>
        )}
      </div>

      <span className="fmt-sep" />

      <button type="button" className="fmt-btn" title="ตัวหนา (Ctrl+B)" onClick={() => runAction('bold')}>
        <Bold size={15} />
      </button>
      <button type="button" className="fmt-btn" title="ตัวเอียง (Ctrl+I)" onClick={() => runAction('italic')}>
        <Italic size={15} />
      </button>
      <button type="button" className="fmt-btn" title="ขีดฆ่า (Ctrl+Shift+X)" onClick={() => runAction('strike')}>
        <Strikethrough size={15} />
      </button>
      <button type="button" className="fmt-btn" title="Inline Code (Ctrl+E)" onClick={() => runAction('code')}>
        <Code size={15} />
      </button>

      <span className="fmt-sep" />

      <button type="button" className="fmt-btn" title="แทรกลิงก์ (Ctrl+K)" onClick={() => runAction('link')}>
        <Link size={15} />
      </button>

      <div className="fmt-menu-wrap">
        <button
          type="button"
          className={`fmt-btn ${openMenu === 'table' ? 'active' : ''}`}
          title="แทรกตาราง / จัดระเบียบตาราง (Ctrl+Shift+T)"
          onClick={handleTableButton}
        >
          <Table2 size={15} />
        </button>
        {openMenu === 'table' && (
          <div className="fmt-popover fmt-table-popover">
            <div className="popover-title">แทรกตาราง</div>
            <label className="popover-field">
              แถว
              <input
                type="number"
                min={1}
                max={20}
                value={tableRows}
                onChange={(e) => setTableRows(Number(e.target.value))}
              />
            </label>
            <label className="popover-field">
              คอลัมน์
              <input
                type="number"
                min={1}
                max={10}
                value={tableCols}
                onChange={(e) => setTableCols(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="popover-confirm"
              onClick={() => {
                const editor = editorRef.current;
                if (editor) {
                  const sel = editor.getSelection();
                  applyResult(createTable(content, sel, tableRows, tableCols));
                  editor.focusTableCellAt(sel.from + 1);
                }
                setOpenMenu(null);
              }}
            >
              แทรก {tableRows} × {tableCols}
            </button>
          </div>
        )}
      </div>

      <button type="button" className="fmt-btn" title="แทรกรูปภาพ (หรือ Ctrl+V วางรูปได้เลย)" onClick={() => runAction('image')}>
        <Image size={15} />
      </button>
      <button type="button" className="fmt-btn" title="อ้างอิง Quote (Ctrl+Shift+Q)" onClick={() => runAction('quote')}>
        <Quote size={15} />
      </button>
      <button type="button" className="fmt-btn" title="บล็อกโค้ด" onClick={() => runAction('codeblock')}>
        <Terminal size={15} />
      </button>

      <span className="fmt-sep" />

      <button type="button" className="fmt-btn" title="ล้างรูปแบบข้อความ (Ctrl+Space)" onClick={() => runAction('clear')}>
        <Eraser size={15} />
      </button>

      <div className="spacer" />

      <button
        type="button"
        className={`fmt-btn ${wordWrap ? 'active' : ''}`}
        title="ตัดบรรทัดอัตโนมัติ (Word Wrap)"
        onClick={toggleWordWrap}
      >
        <WrapText size={15} />
      </button>
      <button type="button" className="fmt-btn" title="ค้นหาในโน้ตนี้ (Ctrl+F / Ctrl+H)" onClick={onOpenFind}>
        <Search size={14} />
      </button>

      <NoteHistory />

      <button
        type="button"
        className="fmt-search-pill"
        title="ค้นหาข้ามทุกโปรเจค (Ctrl+P)"
        onClick={onOpenGlobalSearch}
      >
        <Search size={13} />
        <span>ค้นหาโน้ต…</span>
        <kbd>Ctrl+P</kbd>
      </button>

      <button
        type="button"
        className={`fmt-mode-pill ${viewMode === 'formatted' ? 'is-formatted' : 'is-syntax'}`}
        title="สลับมุมมอง Formatted ⇄ Markdown Syntax (Ctrl+Shift+M)"
        onClick={toggleViewMode}
      >
        {viewMode === 'formatted' ? 'AA Formatted' : '</> Syntax'}
      </button>
    </div>
  );
}
