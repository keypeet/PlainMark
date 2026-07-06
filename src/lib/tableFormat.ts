// จัดระเบียบบล็อกตารางให้เป็น GFM table ที่ถูกต้อง — สำหรับตอนผู้ใช้พิมพ์แถว | ... | เอง
// แล้วไม่มีแถวคั่น หรือพิมพ์แถวคั่นผิด (เช่น | ข้อความ | --- | --- |) ทำให้ markdown ไม่มองเป็นตาราง
import type { FormatResult } from '../types';

const tableRowLine = /^\s*\|.*\|\s*$/;
const separatorCell = /^:?-+:?$/;
const blankLine = /^\s*$/;

type Alignment = 'none' | 'left' | 'right' | 'center';

/** แยกเซลล์จากบรรทัดตาราง — เคารพ \| ที่ escape ไว้ในเนื้อเซลล์ */
function parseCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  body = body.replace(/(?<!\\)\|\s*$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => separatorCell.test(cell));
}

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

function separatorFor(alignment: Alignment, width: number): string {
  const w = Math.max(width, 3);
  switch (alignment) {
    case 'center':
      return `:${'-'.repeat(w - 2)}:`;
    case 'right':
      return `${'-'.repeat(w - 1)}:`;
    case 'left':
      return `:${'-'.repeat(w - 1)}`;
    default:
      return '-'.repeat(w);
  }
}

/**
 * จัดระเบียบบล็อกตารางรอบ cursor: เติมแถวคั่นถ้าไม่มี, เติมเซลล์ให้ครบทุกแถว,
 * จัดความกว้างคอลัมน์ให้ตรงกัน — คืน null ถ้า cursor ไม่ได้อยู่บนแถวตาราง
 */
export function fixTableBlock(content: string, selection: { from: number; to: number }): FormatResult | null {
  const lines = content.split('\n');

  // หาบรรทัดที่ cursor อยู่จาก offset
  let offset = 0;
  let lineIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const end = offset + lines[i].length;
    if (selection.from >= offset && selection.from <= end) {
      lineIndex = i;
      break;
    }
    offset = end + 1;
  }
  if (lineIndex === -1 || !tableRowLine.test(lines[lineIndex])) return null;

  // ขยายขึ้น-ลงให้ครอบแถวตารางที่ติดกันทั้งหมด — ยอมข้ามบรรทัดว่าง 1 บรรทัดถ้าถัดไปยังเป็นแถวตาราง
  // (ผู้ใช้มักเผลอเว้นบรรทัดระหว่างหัวกับตัวตาราง ทำให้ markdown แตกเป็น 2 ตารางแล้วมีช่องว่างคั่น)
  let first = lineIndex;
  let last = lineIndex;
  for (;;) {
    if (first > 0 && tableRowLine.test(lines[first - 1])) {
      first -= 1;
    } else if (first > 1 && blankLine.test(lines[first - 1]) && tableRowLine.test(lines[first - 2])) {
      first -= 2;
    } else {
      break;
    }
  }
  for (;;) {
    if (last < lines.length - 1 && tableRowLine.test(lines[last + 1])) {
      last += 1;
    } else if (last < lines.length - 2 && blankLine.test(lines[last + 1]) && tableRowLine.test(lines[last + 2])) {
      last += 2;
    } else {
      break;
    }
  }

  // แยกแถวข้อมูลกับแถวคั่น — แถวคั่นเดิม (ถ้ามี) ใช้เป็นแหล่ง alignment แล้วสร้างใหม่เสมอ
  const rows: string[][] = [];
  const separators: string[][] = [];
  for (let i = first; i <= last; i += 1) {
    if (blankLine.test(lines[i])) continue; // บรรทัดว่างที่ข้ามมา — ตัดทิ้งให้ตารางต่อเนื่อง
    const cells = parseCells(lines[i]);
    if (isSeparatorRow(cells)) separators.push(cells);
    else rows.push(cells);
  }
  if (rows.length === 0) return null; // มีแต่แถวคั่น — ไม่มีข้อมูลให้จัด

  const columnCount = Math.max(...rows.map((row) => row.length), separators[0]?.length ?? 0);
  const alignments: Alignment[] = Array.from({ length: columnCount }, (_, column) =>
    separators[0]?.[column] ? alignmentOf(separators[0][column]) : 'none'
  );
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(3, ...rows.map((row) => (row[column] ?? '').length))
  );

  const formatRow = (cells: string[]) =>
    `| ${widths.map((width, column) => (cells[column] ?? '').padEnd(width, ' ')).join(' | ')} |`;

  const formatted = [
    formatRow(rows[0]),
    `| ${widths.map((width, column) => separatorFor(alignments[column], width)).join(' | ')} |`,
    ...rows.slice(1).map(formatRow)
  ].join('\n');

  const blockStart = lines.slice(0, first).reduce((total, line) => total + line.length + 1, 0);
  const blockEnd = blockStart + lines.slice(first, last + 1).join('\n').length;
  const caret = blockStart + formatted.length;

  return {
    content: content.slice(0, blockStart) + formatted + content.slice(blockEnd),
    selectionStart: caret,
    selectionEnd: caret
  };
}
