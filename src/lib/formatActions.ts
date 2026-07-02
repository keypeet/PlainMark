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

export function createTable(content: string, selection: SelectionRange): FormatResult {
  return insertText(
    content,
    selection,
    '\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n',
    3
  );
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

export function createLink(content: string, selection: SelectionRange): FormatResult {
  const text = selectedText(content, selection, 'link text');
  const next = `[${text}](https://example.com)`;
  const start = selection.from + 1;
  return {
    content: content.slice(0, selection.from) + next + content.slice(selection.to),
    selectionStart: start,
    selectionEnd: start + text.length
  };
}

export function createImage(content: string, selection: SelectionRange): FormatResult {
  const text = selectedText(content, selection, 'alt text');
  const next = `![${text}](image.png)`;
  const start = selection.from + 2;
  return {
    content: content.slice(0, selection.from) + next + content.slice(selection.to),
    selectionStart: start,
    selectionEnd: start + text.length
  };
}
