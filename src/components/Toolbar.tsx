import { RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bold,
  Code,
  Heading1,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
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
  | 'task'
  | 'quote'
  | 'table'
  | 'codeblock'
  | 'code'
  | 'link'
  | 'image'
  | 'hr';

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
    label: 'Bullet List',
    shortcut: 'Ctrl+Shift+L',
    syntax: '- item',
    example: '- first item\n- second item',
    icon: <List size={18} />
  },
  {
    id: 'task',
    label: 'Task List',
    shortcut: 'Ctrl+Shift+X',
    syntax: '- [ ] task',
    example: '- [x] Done\n- [ ] Next',
    icon: <ListChecks size={18} />
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
    label: 'Table',
    shortcut: 'Ctrl+Shift+T',
    syntax: '| Col | Col |',
    example: '| Name | Status |\n| --- | --- |\n| PlainMark | MVP |',
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

function runTool(id: ToolId, content: string, selection: { from: number; to: number }): FormatResult {
  switch (id) {
    case 'heading':
      return toggleHeading(content, selection, 1);
    case 'bold':
      return wrapSelection(content, selection, '**', '**', 'bold text');
    case 'italic':
      return wrapSelection(content, selection, '*', '*', 'italic text');
    case 'list':
      return prefixLines(content, selection, '- ');
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
    case 'link':
      return createLink(content, selection);
    case 'image':
      return createImage(content, selection);
    case 'hr':
      return insertText(content, selection, '\n---\n');
  }
}

export function Toolbar({ editorRef }: ToolbarProps) {
  const content = useDocStore((state) => state.content);
  const [activeTool, setActiveTool] = useState<ToolConfig | null>(null);

  const applyTool = useCallback(
    (toolId: ToolId) => {
      const editor = editorRef.current;
      if (!editor) return;
      const result = runTool(toolId, content, editor.getSelection());
      editor.replaceContent(result.content, result.selectionStart, result.selectionEnd);
      editor.focus();
    },
    [content, editorRef]
  );

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
        l: shifted ? 'list' : undefined,
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
            onClick={() => applyTool(tool.id)}
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

      {activeTool && (
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
    </aside>
  );
}
