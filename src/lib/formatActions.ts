import type { FormatResult } from '../types';
import { tableRowOf } from './tableFormat';

interface SelectionRange {
  from: number;
  to: number;
}

function selectedText(content: string, selection: SelectionRange, placeholder: string): string {
  return content.slice(selection.from, selection.to) || placeholder;
}

// ---------- wrap แบบซ้อน/ถอดได้ (bold, italic, code, strikethrough) ----------
// เป้าหมาย: จัดรูปแบบหลายอย่างซ้อนกันได้ในการเลือกเดียว เช่น หัวข้อ+หนา, ตาราง+หนา (รายเซลล์)
// bold/italic นับจำนวน * หัวท้าย เพื่อให้ซ้อน/ถอดถูกต้อง: **x** + italic → ***x***, ***x*** + bold → *x*

const tableRowLine = /^\s*\|.*\|\s*$/;
const separatorCell = /^:?-{3,}:?$/;
// marker ระดับบรรทัด (heading/quote/list/checkbox — ซ้อนกันได้ เช่น "> - ") ที่ marker inline ต้องอยู่ถัดจากมัน
const leadingBlockMarkers = /^\s*(?:(?:#{1,6}|>|\d+\.|[-*+](?:\s+\[[ xX]\])?)\s+)*/;

function starRun(text: string, side: 'start' | 'end'): number {
  const match = side === 'start' ? /^\*+/.exec(text) : /\*+$/.exec(text);
  return match ? match[0].length : 0;
}

function hasWrap(core: string, before: string, after: string): boolean {
  if (before === '**' || before === '*') {
    const depth = Math.min(starRun(core, 'start'), starRun(core, 'end'));
    return before === '**' ? depth >= 2 : depth % 2 === 1;
  }
  return core.length > before.length + after.length && core.startsWith(before) && core.endsWith(after);
}

function toggleCore(core: string, before: string, after: string, unwrap: boolean): string {
  if (unwrap) return hasWrap(core, before, after) ? core.slice(before.length, core.length - after.length) : core;
  return hasWrap(core, before, after) ? core : `${before}${core}${after}`;
}

function containingLine(content: string, index: number): string {
  const start = content.lastIndexOf('\n', Math.max(index - 1, 0)) + 1;
  const end = content.indexOf('\n', index);
  return content.slice(start, end === -1 ? content.length : end);
}

// เลือกเฉพาะเนื้อใน แต่ marker อยู่ชิดรอบนอก selection (เช่นเลือก bold ใน **bold**) → ถอดออก
function unwrapOutside(content: string, selection: SelectionRange, before: string, after: string): FormatResult | null {
  const { from, to } = selection;
  if (before === '**' || before === '*') {
    const left = starRun(content.slice(Math.max(0, from - 3), from), 'end');
    const right = starRun(content.slice(to, to + 3), 'start');
    const depth = Math.min(left, right);
    const matched = before === '**' ? depth >= 2 : depth % 2 === 1;
    if (!matched) return null;
  } else if (
    from < before.length ||
    content.slice(from - before.length, from) !== before ||
    content.slice(to, to + after.length) !== after
  ) {
    return null;
  }
  return {
    content: content.slice(0, from - before.length) + content.slice(from, to) + content.slice(to + after.length),
    selectionStart: from - before.length,
    selectionEnd: to - before.length
  };
}

export function wrapSelection(
  content: string,
  selection: SelectionRange,
  before: string,
  after: string,
  placeholder: string
): FormatResult {
  const text = content.slice(selection.from, selection.to);

  // ไม่ได้เลือกอะไร → แทรก placeholder พร้อม marker แล้วเลือกตัว placeholder ไว้ให้พิมพ์ทับ (พฤติกรรมเดิม)
  if (!text) {
    const nextContent = content.slice(0, selection.from) + before + placeholder + after + content.slice(selection.to);
    const selectionStart = selection.from + before.length;
    return { content: nextContent, selectionStart, selectionEnd: selectionStart + placeholder.length };
  }

  const outside = unwrapOutside(content, selection, before, after);
  if (outside) return outside;

  // แตกเป็น segment: แถวตาราง → รายเซลล์ (ข้ามแถวคั่น ---), บรรทัดอื่น → เนื้อความหลัง block marker
  const pieces = text.split('\n');
  interface PieceInfo {
    piece: string;
    isTable: boolean;
    prefix: string; // block marker นำหน้า (มีผลเฉพาะ piece ที่เริ่มที่ต้นบรรทัดจริง)
  }
  const infos: PieceInfo[] = [];
  const cores: string[] = [];
  let pieceStart = selection.from;

  for (const piece of pieces) {
    const atLineStart = pieceStart === 0 || content[pieceStart - 1] === '\n';
    const isTable = piece.includes('|') && tableRowLine.test(containingLine(content, pieceStart));
    const prefix = !isTable && atLineStart ? leadingBlockMarkers.exec(piece)![0] : '';
    infos.push({ piece, isTable, prefix });
    if (isTable) {
      for (const cell of piece.split('|')) {
        const core = cell.trim();
        if (core && !separatorCell.test(core)) cores.push(core);
      }
    } else {
      const core = piece.slice(prefix.length).trim();
      if (core) cores.push(core);
    }
    pieceStart += piece.length + 1; // +1 = ตัว \n ที่ split ออก
  }

  // ทุก segment มี marker นี้อยู่แล้ว → ถอดออกทั้งชุด, ไม่งั้นเติมเฉพาะตัวที่ยังไม่มี
  const unwrap = cores.length > 0 && cores.every((core) => hasWrap(core, before, after));

  const transformed = infos.map(({ piece, isTable, prefix }) => {
    if (isTable) {
      return piece
        .split('|')
        .map((cell) => {
          const core = cell.trim();
          if (!core || separatorCell.test(core)) return cell;
          const lead = /^\s*/.exec(cell)![0];
          const trail = cell.slice(lead.length + core.length);
          return lead + toggleCore(core, before, after, unwrap) + trail;
        })
        .join('|');
    }
    const rest = piece.slice(prefix.length);
    const core = rest.trim();
    if (!core) return piece;
    const lead = /^\s*/.exec(rest)![0];
    const trail = rest.slice(lead.length + core.length);
    return prefix + lead + toggleCore(core, before, after, unwrap) + trail;
  });

  const nextText = transformed.join('\n');
  const nextContent = content.slice(0, selection.from) + nextText + content.slice(selection.to);

  // เลือกก้อนเดียวธรรมดา → คงพฤติกรรมเดิม: เลือกเฉพาะเนื้อความข้างใน marker เพื่อกดจัดรูปแบบต่อได้ทันที
  const single = infos.length === 1 && !infos[0].isTable;
  if (single && cores.length === 1) {
    const { prefix, piece } = infos[0];
    const lead = /^\s*/.exec(piece.slice(prefix.length))![0];
    const coreStart = selection.from + prefix.length + lead.length + (unwrap ? 0 : before.length);
    const coreLength = unwrap ? cores[0].length - before.length - after.length : cores[0].length;
    return { content: nextContent, selectionStart: coreStart, selectionEnd: coreStart + coreLength };
  }

  // หลายบรรทัด/ตาราง → เลือกคลุมทั้งช่วงที่แปลง เผื่อกดจัดรูปแบบตัวถัดไปซ้อนอีก
  return { content: nextContent, selectionStart: selection.from, selectionEnd: selection.from + nextText.length };
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
  // ทุกช่องว่างเปล่า (รวมหัวตาราง) — ผู้ใช้กรอกเองในกริดของโหมด full ไม่ต้องลบ placeholder ก่อน
  const header = tableRowOf(safeCols, '   ');
  const divider = tableRowOf(safeCols, '---');
  const body = Array.from({ length: safeRows }, () => tableRowOf(safeCols, '   ')).join('\n');
  // cursor ไปอยู่หลังตาราง (ไม่ใช่ในตาราง) — โหมด full จะได้ render เป็นกริดให้คลิกกรอกช่องได้ทันที
  return insertText(content, selection, `\n${header}\n${divider}\n${body}\n`);
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
