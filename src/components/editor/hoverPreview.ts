// Hover Preview — ชี้เมาส์ค้างบน Markdown ใน editor แล้วเห็นผลจริงเฉพาะจุดนั้น (advanced_features.md ข้อ 5)
// รองรับ Image, Table, Link, Code fence และ Quote — render ด้วย engine เดียวกับ preview หลัก
// เพื่อให้สิ่งที่เห็นใน tooltip ตรงกับ Markdown Preview เสมอ
import type { Extension } from '@codemirror/state';
import { EditorView, hoverTooltip } from '@codemirror/view';
import { renderMarkdown } from '../../lib/markdownEngine';

interface HoverBlock {
  from: number;
  to: number;
  /** Markdown ที่จะ render ใน tooltip (รวมนิยาม reference ท้ายเอกสารแล้ว) */
  source: string;
}

const tableLine = /^\s*\|.*\|\s*$/;
const quoteLine = /^\s*>/;
const imageOrLink = /!?\[[^\]]*\][([]/;
const bareUrl = /https?:\/\/\S+/;
const fenceLine = /^\s*(```|~~~)/;

/** นิยาม reference ([id]: url) ทั้งเอกสาร — ต้องพ่วงไปด้วยให้รูป/ลิงก์ reference-style แสดงได้ */
function referenceDefinitions(doc: string): string {
  const definitions = doc.match(/^\[[^\]]+\]:\s+\S+.*$/gm);
  return definitions ? `\n\n${definitions.join('\n')}` : '';
}

/** ขยายช่วงบรรทัดต่อเนื่องที่เข้าเงื่อนไขเดียวกัน (ตาราง/quote กินหลายบรรทัด) */
function expandLines(view: EditorView, lineNumber: number, matches: (text: string) => boolean): HoverBlock {
  const doc = view.state.doc;
  let first = lineNumber;
  let last = lineNumber;
  while (first > 1 && matches(doc.line(first - 1).text)) first -= 1;
  while (last < doc.lines && matches(doc.line(last + 1).text)) last += 1;
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  return { from, to, source: doc.sliceString(from, to) };
}

/** หา code fence ที่ครอบบรรทัดนี้ (เดินหา ``` เปิด-ปิด) */
function findCodeFence(view: EditorView, lineNumber: number): HoverBlock | null {
  const doc = view.state.doc;
  let open = -1;
  for (let i = 1; i <= doc.lines && i <= lineNumber; i += 1) {
    if (fenceLine.test(doc.line(i).text)) open = open === -1 ? i : -1; // สลับเปิด/ปิด
  }
  if (open === -1) return null;
  for (let close = Math.max(lineNumber, open + 1); close <= doc.lines; close += 1) {
    if (close > open && fenceLine.test(doc.line(close).text)) {
      const from = doc.line(open).from;
      const to = doc.line(close).to;
      return { from, to, source: doc.sliceString(from, to) };
    }
  }
  return null;
}

/** ตัดสินว่าตำแหน่งที่ hover อยู่ใน block ที่ preview ได้หรือไม่ */
function blockAt(view: EditorView, pos: number): HoverBlock | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;

  if (tableLine.test(text)) return expandLines(view, line.number, (t) => tableLine.test(t));
  if (quoteLine.test(text)) return expandLines(view, line.number, (t) => quoteLine.test(t));

  const fence = findCodeFence(view, line.number);
  if (fence) return fence;

  // รูป / ลิงก์ / URL เปล่า — preview ทั้งบรรทัด (สั้นพอและได้ context ครบ)
  if (imageOrLink.test(text) || bareUrl.test(text)) {
    return { from: line.from, to: line.to, source: text };
  }
  return null;
}

export function hoverPreview(): Extension {
  return hoverTooltip(
    (view, pos) => {
      const block = blockAt(view, pos);
      if (!block) return null;

      const source = block.source + referenceDefinitions(view.state.doc.toString());
      const html = renderMarkdown(source);
      if (!html.trim()) return null;

      return {
        pos: block.from,
        end: block.to,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-hover-preview markdown-body';
          dom.innerHTML = html; // ผ่าน DOMPurify ใน renderMarkdown แล้ว
          return { dom };
        }
      };
    },
    { hoverTime: 450 }
  );
}
