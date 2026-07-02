// นิยามเครื่องมือจัดรูปแบบทั้งหมดของ Toolbar — ข้อมูล + logic แยกจากส่วนแสดงผล (Toolbar.tsx)
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
} from '../../lib/formatActions';
import type { FormatResult } from '../../types';

export type ToolId =
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

export interface ToolConfig {
  id: ToolId;
  label: string;
  shortcut: string;
  syntax: string;
  example: string;
  icon: JSX.Element;
  groupAfter?: boolean;
}

export const tools: ToolConfig[] = [
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

// ตัวเลือกในลิสต์ popover (bullet/ordered/task ไม่ใช่ปุ่มหลักบน Toolbar)
export const listOptions: Array<{ tool: ToolId; label: string; icon: JSX.Element }> = [
  { tool: 'bullet', label: 'จุดวงกลม (- )', icon: <List size={15} /> },
  { tool: 'ordered', label: 'ตัวเลข (1. )', icon: <ListOrdered size={15} /> },
  { tool: 'task', label: 'เช็คลิสต์ (- [ ] )', icon: <ListChecks size={15} /> }
];

// คีย์ลัดจัดรูปแบบ (Ctrl/Cmd + key, shift ต้องตรงตามระบุ) — ตารางเดียวเป็น source of truth
export const toolShortcuts: Array<{ key: string; shift: boolean; tool: ToolId }> = [
  { key: '1', shift: false, tool: 'heading' },
  { key: 'b', shift: false, tool: 'bold' },
  { key: 'i', shift: false, tool: 'italic' },
  { key: 'e', shift: false, tool: 'code' },
  { key: 'k', shift: false, tool: 'link' },
  { key: 'l', shift: true, tool: 'bullet' },
  { key: 'o', shift: true, tool: 'ordered' },
  { key: 'x', shift: true, tool: 'task' },
  { key: 'q', shift: true, tool: 'quote' },
  { key: 't', shift: true, tool: 'table' },
  { key: 'c', shift: true, tool: 'codeblock' },
  { key: 'i', shift: true, tool: 'image' },
  { key: 'h', shift: true, tool: 'hr' }
];

export function runTool(id: ToolId, content: string, selection: { from: number; to: number }): FormatResult | null {
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
