import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTable } from '../lib/formatActions';
import { fixTableBlock } from '../lib/tableFormat';
import { renderMarkdown } from '../lib/markdownEngine';
import { useDocStore } from '../store/docStore';
import type { EditorApi, FormatResult } from '../types';
import { listOptions, runTool, tools, toolShortcuts } from './toolbar/toolConfig';
import type { ToolConfig, ToolId } from './toolbar/toolConfig';

type PopoverKind = 'table' | 'list';

interface ToolbarProps {
  editorRef: RefObject<EditorApi>;
}

export function Toolbar({ editorRef }: ToolbarProps) {
  const content = useDocStore((state) => state.content);
  const [activeTool, setActiveTool] = useState<ToolConfig | null>(null);
  const [popover, setPopover] = useState<PopoverKind | null>(null);
  const [popoverTop, setPopoverTop] = useState(72);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const applyResult = useCallback(
    (result: FormatResult | null) => {
      const editor = editorRef.current;
      if (!editor || !result) return;
      editor.replaceContent(result.content, result.selectionStart, result.selectionEnd);
      editor.focus();
    },
    [editorRef]
  );

  const applyTool = useCallback(
    (toolId: ToolId) => {
      const editor = editorRef.current;
      if (!editor) return;
      applyResult(runTool(toolId, content, editor.getSelection()));
    },
    [applyResult, content, editorRef]
  );

  const insertTable = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    applyResult(createTable(content, editor.getSelection(), tableRows, tableCols));
    setPopover(null);
  }, [applyResult, content, editorRef, tableCols, tableRows]);

  const handleToolClick = useCallback(
    (toolId: ToolId, event: React.MouseEvent<HTMLButtonElement>) => {
      if (toolId === 'table') {
        // cursor อยู่ในบล็อกตาราง → จัดระเบียบตารางนั้นเลย ไม่ต้องเปิด popover แทรกใหม่
        const editor = editorRef.current;
        const fixed = editor ? fixTableBlock(content, editor.getSelection()) : null;
        if (fixed) {
          applyResult(fixed);
          setPopover(null);
          return;
        }
      }
      if (toolId === 'table' || toolId === 'list') {
        const kind: PopoverKind = toolId === 'table' ? 'table' : 'list';
        setPopoverTop(Math.min(event.currentTarget.getBoundingClientRect().top, window.innerHeight - 220));
        setPopover((current) => (current === kind ? null : kind));
        return;
      }
      setPopover(null);
      applyTool(toolId);
    },
    [applyResult, applyTool, content, editorRef]
  );

  // ปิด popover เมื่อคลิกที่อื่น
  useEffect(() => {
    if (!popover) return;
    const handler = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setPopover(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [popover]);

  // คีย์ลัดจัดรูปแบบ — จับคู่จากตาราง toolShortcuts (source of truth เดียวกับ tooltip)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const binding = toolShortcuts.find((item) => item.key === key && item.shift === event.shiftKey);
      if (!binding) return;
      event.preventDefault();
      applyTool(binding.tool);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [applyTool]);

  const previewHtml = useMemo(() => (activeTool ? renderMarkdown(activeTool.example) : ''), [activeTool]);

  return (
    <aside className="toolbar" aria-label="Markdown tools">
      {tools.map((tool) => (
        <div key={tool.id} className="tool-wrap">
          <button
            className="tool-button"
            aria-label={tool.label}
            title={tool.label}
            onClick={(event) => handleToolClick(tool.id, event)}
            onFocus={() => setActiveTool(tool)}
            onBlur={() => setActiveTool(null)}
            onMouseEnter={() => setActiveTool(tool)}
            onMouseLeave={() => setActiveTool(null)}
          >
            {tool.icon}
          </button>
          {tool.groupAfter && <span className="tool-separator" />}
        </div>
      ))}

      {activeTool && !popover && (
        <div className="tool-tip">
          <div className="tip-head">
            <strong>{activeTool.label}</strong>
            <span>{activeTool.shortcut}</span>
          </div>
          <div className="tip-label">Preview</div>
          <div className="tip-preview markdown-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <div className="tip-code">{activeTool.syntax}</div>
        </div>
      )}

      {popover === 'table' && (
        <div className="tool-popover" ref={popoverRef} style={{ top: popoverTop }}>
          <div className="popover-title">แทรกตาราง</div>
          <label className="popover-field">
            แถว
            <input
              type="number"
              min={1}
              max={20}
              value={tableRows}
              onChange={(event) => setTableRows(Number(event.target.value))}
            />
          </label>
          <label className="popover-field">
            คอลัมน์
            <input
              type="number"
              min={1}
              max={10}
              value={tableCols}
              onChange={(event) => setTableCols(Number(event.target.value))}
            />
          </label>
          <button className="popover-confirm" onClick={insertTable}>
            แทรกตาราง {tableRows} × {tableCols}
          </button>
        </div>
      )}

      {popover === 'list' && (
        <div className="tool-popover" ref={popoverRef} style={{ top: popoverTop }}>
          <div className="popover-title">เลือกชนิดลิสต์</div>
          {listOptions.map((option) => (
            <button
              key={option.tool}
              className="popover-option"
              onClick={() => {
                applyTool(option.tool);
                setPopover(null);
              }}
            >
              {option.icon} {option.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
