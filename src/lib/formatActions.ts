import type { FormatResult } from '../types';

interface SelectionRange {
  from: number;
  to: number;
}

function selectedText(content: string, selection: SelectionRange, placeholder: string): string {
  return content.slice(selection.from, selection.to) || placeholder;
}

export function wrapSelection(
  content: string,
  selection: SelectionRange,
  before: string,
  after: string,
  placeholder: string
): FormatResult {
  const text = selectedText(content, selection, placeholder);
  const nextContent = content.slice(0, selection.from) + before + text + after + content.slice(selection.to);
  const selectionStart = selection.from + before.length;
  const selectionEnd = selectionStart + text.length;

  return { content: nextContent, selectionStart, selectionEnd };
}

export function insertText(content: string, selection: SelectionRange, text: string, cursorOffset = text.length): FormatResult {
  const nextContent = content.slice(0, selection.from) + text + content.slice(selection.to);
  const cursor = selection.from + cursorOffset;
  return { content: nextContent, selectionStart: cursor, selectionEnd: cursor };
}

export function prefixLines(content: string, selection: SelectionRange, prefix: string): FormatResult {
  const lineStart = content.lastIndexOf('\n', Math.max(selection.from - 1, 0)) + 1;
  const selectedBlock = content.slice(lineStart, selection.to);
  const nextBlock = selectedBlock
    .split('\n')
    .map((line) => (line.trim().length ? `${prefix}${line}` : line))
    .join('\n');
  const nextContent = content.slice(0, lineStart) + nextBlock + content.slice(selection.to);
  const added = nextBlock.length - selectedBlock.length;

  return {
    content: nextContent,
    selectionStart: selection.from + prefix.length,
    selectionEnd: selection.to + added
  };
}

export function toggleHeading(content: string, selection: SelectionRange, level = 1): FormatResult {
  const lineStart = content.lastIndexOf('\n', Math.max(selection.from - 1, 0)) + 1;
  const lineEndIndex = content.indexOf('\n', selection.from);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const line = content.slice(lineStart, lineEnd);
  const cleanLine = line.replace(/^#{1,6}\s+/, '');
  const prefix = '#'.repeat(level) + ' ';
  const nextLine = line.startsWith(prefix) ? cleanLine : `${prefix}${cleanLine}`;
  const nextContent = content.slice(0, lineStart) + nextLine + content.slice(lineEnd);
  const offset = nextLine.length - line.length;

  return {
    content: nextContent,
    selectionStart: Math.max(lineStart + prefix.length, selection.from + offset),
    selectionEnd: Math.max(lineStart + prefix.length, selection.to + offset)
  };
}

export function createTable(content: string, selection: SelectionRange, rows = 2, cols = 2): FormatResult {
  const safeRows = Math.max(1, Math.min(20, Math.floor(rows)));
  const safeCols = Math.max(1, Math.min(10, Math.floor(cols)));
  const header = `| ${Array.from({ length: safeCols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`;
  const divider = `| ${Array.from({ length: safeCols }, () => '---').join(' | ')} |`;
  const body = Array.from(
    { length: safeRows },
    () => `| ${Array.from({ length: safeCols }, () => '   ').join(' | ')} |`
  ).join('\n');
  return insertText(content, selection, `\n${header}\n${divider}\n${body}\n`, 3);
}

// เติมเลขลำดับ 1. 2. 3. ให้แต่ละบรรทัดที่เลือก (บรรทัดว่างข้าม ไม่นับ)
export function prefixOrderedList(content: string, selection: SelectionRange): FormatResult {
  const lineStart = content.lastIndexOf('\n', Math.max(selection.from - 1, 0)) + 1;
  const selectedBlock = content.slice(lineStart, selection.to);
  let order = 0;
  const nextBlock = selectedBlock
    .split('\n')
    .map((line) => (line.trim().length ? `${++order}. ${line}` : line))
    .join('\n');
  const nextContent = content.slice(0, lineStart) + nextBlock + content.slice(selection.to);
  const added = nextBlock.length - selectedBlock.length;

  return {
    content: nextContent,
    selectionStart: selection.from + 3,
    selectionEnd: selection.to + added
  };
}

export const longUrlThreshold = 50;

function nextRefId(content: string, prefix: string): string {
  const pattern = new RegExp(`^\\[${prefix}(\\d+)\\]:`, 'gm');
  const ids = Array.from(content.matchAll(pattern), (match) => Number(match[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `${prefix}${next}`;
}

// ย่อ URL ยาวเป็น reference-style: ตัวลิงก์สั้นอยู่ในเนื้อหา ส่วน URL จริงไปอยู่ท้ายเอกสาร
export function insertReferenceLink(
  content: string,
  selection: SelectionRange,
  url: string,
  kind: 'link' | 'image',
  label?: string
): FormatResult {
  const isImage = kind === 'image';
  const id = nextRefId(content, isImage ? 'img' : 'ref');
  const text = label || selectedText(content, selection, isImage ? 'รูปภาพ' : 'ลิงก์');
  const marker = `${isImage ? '!' : ''}[${text}][${id}]`;
  const withMarker = content.slice(0, selection.from) + marker + content.slice(selection.to);
  // marker ไม่ลงท้ายด้วย whitespace ดังนั้น trimEnd ตัดได้แค่ช่องว่างหลัง marker
  const cursor = Math.min(selection.from + marker.length, withMarker.trimEnd().length);
  const nextContent = `${withMarker.trimEnd()}\n\n[${id}]: ${url}\n`;

  return { content: nextContent, selectionStart: cursor, selectionEnd: cursor };
}

export function createCodeBlock(content: string, selection: SelectionRange): FormatResult {
  const selected = content.slice(selection.from, selection.to);
  const code = selected || 'code';
  const text = `\n\`\`\`txt\n${code}\n\`\`\`\n`;
  const start = selection.from + '\n```txt\n'.length;
  return {
    content: content.slice(0, selection.from) + text + content.slice(selection.to),
    selectionStart: start,
    selectionEnd: start + code.length
  };
}

export function createLink(content: string, selection: SelectionRange, url = 'https://example.com'): FormatResult {
  if (url.length > longUrlThreshold) {
    return insertReferenceLink(content, selection, url, 'link');
  }
  const text = selectedText(content, selection, 'link text');
  const next = `[${text}](${url})`;
  const start = selection.from + 1;
  return {
    content: content.slice(0, selection.from) + next + content.slice(selection.to),
    selectionStart: start,
    selectionEnd: start + text.length
  };
}

export function createImage(content: string, selection: SelectionRange, url = 'image.png'): FormatResult {
  if (url.length > longUrlThreshold) {
    return insertReferenceLink(content, selection, url, 'image');
  }
  const text = selectedText(content, selection, 'alt text');
  const next = `![${text}](${url})`;
  const start = selection.from + 2;
  return {
    content: content.slice(0, selection.from) + next + content.slice(selection.to),
    selectionStart: start,
    selectionEnd: start + text.length
  };
}
