import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Code,
  Heading1,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table2,
  Terminal
} from 'lucide-react';
import {
  createCodeBlock,
  createImage,
  createLink,
  createTable,
  insertText,
  prefixLines,
  prefixOrderedList,
  toggleHeading,
  wrapSelection
} from '../lib/formatActions';
import { renderMarkdown } from '../lib/markdownEngine';
import { useDocStore } from '../store/docStore';
import type { EditorApi, FormatResult } from '../types';

type ToolId =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'list'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'
  | 'table'
  | 'codeblock'
  | 'code'
  | 'link'
  | 'image'
  | 'hr';

type PopoverKind = 'table' | 'list';

interface ToolbarProps {
  editorRef: RefObject<EditorApi>;
}

interface ToolConfig {
  id: ToolId;
  label: string;
  shortcut: string;
  syntax: string;
  example: string;
  icon: JSX.Element;
  groupAfter?: boolean;
}

const tools: ToolConfig[] = [
  {
    id: 'heading',
    label: 'Heading',
    shortcut: 'Ctrl+1',
    syntax: '# Heading',
    example: '# Heading',
    icon: <Heading1 size={18} />
  },
  {
    id: 'bold',
    label: 'Bold',
    shortcut: 'Ctrl+B',
    syntax: '**text**',
    example: 'This is **bold** text.',
    icon: <Bold size={18} />
  },
  {
    id: 'italic',
    label: 'Italic',
    shortcut: 'Ctrl+I',
    syntax: '*text*',
    example: 'This is *italic* text.',
    icon: <Italic size={18} />,
    groupAfter: true
  },
  {
    id: 'list',
    label: 'List (เลือกชนิด)',
    shortcut: 'Ctrl+Shift+L',
    syntax: '- item / 1. item / - [ ] task',
    example: '- bullet\n\n1. numbered\n\n- [ ] task',
    icon: <List size={18} />
  },
  {
    id: 'quote',
    label: 'Quote',
    shortcut: 'Ctrl+Shift+Q',
    syntax: '> quote',
    example: '> A short note worth calling out.',
    icon: <Quote size={18} />,
    groupAfter: true
  },
  {
    id: 'table',
    label: 'Table (เลือกขนาด)',
    shortcut: 'Ctrl+Shift+T',
    syntax: '| Col | Col |',
    example: '| Name | Status |\n| --- | --- |\n| PlainMark | v0.5 |',
    icon: <Table2 size={18} />
  },
  {
    id: 'codeblock',
    label: 'Code Block',
    shortcut: 'Ctrl+Shift+C',
    syntax: '```txt\ncode\n```',
    example: '```ts\nconsole.log("PlainMark");\n```',
    icon: <Terminal size={18} />
  },
  {
    id: 'code',
    label: 'Inline Code',
    shortcut: 'Ctrl+E',
    syntax: '`code`',
    example: 'Run `npm install` first.',
    icon: <Code size={18} />,
    groupAfter: true
  },
  {
    id: 'link',
    label: 'Link',
    shortcut: 'Ctrl+K',
    syntax: '[text](url)',
    example: '[Markdown Guide](https://www.markdownguide.org/)',
    icon: <Link size={18} />
  },
  {
    id: 'image',
    label: 'Image',
    shortcut: 'Ctrl+Shift+I',
    syntax: '![alt](image.png)',
    example: '![Alt text](image.png)',
    icon: <Image size={18} />
  },
  {
    id: 'hr',
    label: 'Horizontal Rule',
    shortcut: 'Ctrl+Shift+H',
    syntax: '---',
    example: 'Before\n\n---\n\nAfter',
    icon: <Minus size={18} />
  }
];

function runTool(id: ToolId, content: string, selection: { from: number; to: number }): FormatResult | null {
  switch (id) {
    case 'heading':
      return toggleHeading(content, selection, 1);
    case 'bold':
      return wrapSelection(content, selection, '**', '**', 'bold text');
    case 'italic':
      return wrapSelection(content, selection, '*', '*', 'italic text');
    case 'list':
    case 'bullet':
      return prefixLines(content, selection, '- ');
    case 'ordered':
      return prefixOrderedList(content, selection);
    case 'task':
      return prefixLines(content, selection, '- [ ] ');
    case 'quote':
      return prefixLines(content, selection, '> ');
    case 'table':
      return createTable(content, selection);
    case 'codeblock':
      return createCodeBlock(content, selection);
    case 'code':
      return wrapSelection(content, selection, '`', '`', 'code');
    case 'link': {
      const url = window.prompt('วางลิงก์ (URL):', 'https://');
      if (!url || url === 'https://') return null;
      return createLink(content, selection, url.trim());
    }
    case 'image': {
      const url = window.prompt('วางลิงก์รูปภาพ (URL หรือชื่อไฟล์):', '');
      if (!url) return null;
      return createImage(content, selection, url.trim());
    }
    case 'hr':
      return insertText(content, selection, '\n---\n');
  }
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
      if (toolId === 'table' || toolId === 'list') {
        const kind: PopoverKind = toolId === 'table' ? 'table' : 'list';
        setPopoverTop(Math.min(event.currentTarget.getBoundingClientRect().top, window.innerHeight - 220));
        setPopover((current) => (current === kind ? null : kind));
        return;
      }
      setPopover(null);
      applyTool(toolId);
    },
    [applyTool]
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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const shifted = event.shiftKey;
      const map: Record<string, ToolId | undefined> = {
        b: !shifted ? 'bold' : undefined,
        i: !shifted ? 'italic' : shifted ? 'image' : undefined,
        e: !shifted ? 'code' : undefined,
        k: !shifted ? 'link' : undefined,
        l: shifted ? 'bullet' : undefined,
        o: shifted ? 'ordered' : undefined,
        x: shifted ? 'task' : undefined,
        q: shifted ? 'quote' : undefined,
        t: shifted ? 'table' : undefined,
        c: shifted ? 'codeblock' : undefined,
        h: shifted ? 'hr' : undefined,
        '1': !shifted ? 'heading' : undefined
      };
      const tool = map[key];
      if (!tool) return;
      event.preventDefault();
      applyTool(tool);
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
          <button
            className="popover-option"
            onClick={() => {
              applyTool('bullet');
              setPopover(null);
            }}
          >
            <List size={15} /> จุดวงกลม (- )
          </button>
          <button
            className="popover-option"
            onClick={() => {
              applyTool('ordered');
              setPopover(null);
            }}
          >
            <ListOrdered size={15} /> ตัวเลข (1. )
          </button>
          <button
            className="popover-option"
            onClick={() => {
              applyTool('task');
              setPopover(null);
            }}
          >
            <ListChecks size={15} /> เช็คลิสต์ (- [ ] )
          </button>
        </div>
      )}
    </aside>
  );
}
