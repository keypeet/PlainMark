// Live Markdown (โหมด Full) — แสดงผลจัดฟอร์แมตทับ syntax markdown ในบรรทัดเดียวกับที่พิมพ์
// แนวคิดแบบ Typora: ซ่อนสัญลักษณ์ (**, #, `) ยกเว้นบรรทัด/ช่วงที่ cursor อยู่ ซึ่งจะโชว์ raw text ให้แก้ไขได้ปกติ
import type { EditorState, Extension, Range, Text } from '@codemirror/state';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { renderMarkdown } from '../../lib/markdownEngine';
import { fixTableBlock } from '../../lib/tableFormat';

const headingLine = /^(#{1,6})\s+/;
const quoteMarker = /^(\s*>\s?)/;
const bulletMarker = /^(\s*)([-*+])(\s+)/;
const fenceLine = /^\s*(```|~~~)/;
const tableRowLine = /^\s*\|.*\|\s*$/;
const refDefLine = /^\[([^\]]+)\]:\s+(\S+)/;
const blankOnly = /^\s*$/;

const inlinePatterns: { type: string; re: RegExp; markerLen: (m: RegExpExecArray) => [number, number] }[] = [
  { type: 'bold', re: /\*\*([^*\n]+)\*\*/g, markerLen: () => [2, 2] },
  { type: 'bold', re: /__([^_\n]+)__/g, markerLen: () => [2, 2] },
  { type: 'italic', re: /(?<!\*)\*([^*\n]+)\*(?!\*)/g, markerLen: () => [1, 1] },
  { type: 'italic', re: /(?<!_)_([^_\n]+)_(?!_)/g, markerLen: () => [1, 1] },
  { type: 'strikethrough', re: /~~([^~\n]+)~~/g, markerLen: () => [2, 2] },
  { type: 'code', re: /`([^`\n]+)`/g, markerLen: () => [1, 1] }
];

const linkPattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const refImagePattern = /!\[([^\]]*)\]\[([^\]]+)\]/g;

function cursorTouches(from: number, to: number, ranges: readonly { from: number; to: number }[]): boolean {
  for (const range of ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

class BulletWidget extends WidgetType {
  constructor(private readonly ordered: string | null) {
    super();
  }
  eq(other: BulletWidget) {
    return other.ordered === this.ordered;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-lm-bullet';
    span.textContent = this.ordered ?? '•';
    return span;
  }
}

// ต้องเป็น named class — ถ้าใช้ anonymous class ต่อ match, eq() จะไม่มีวันเท่ากันข้ามรอบ build
// ทำให้ <img> ถูกสร้างใหม่ (โหลดรูปใหม่/กะพริบ) ทุกครั้งที่พิมพ์
class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'cm-lm-image';
    return img;
  }
}

/** รวบรวมนิยาม reference ([id]: url) ทั้งเอกสาร — ใช้ resolve รูป/ลิงก์แบบ ![alt][id] และพ่วงท้าย source ของตาราง */
function collectReferenceDefs(doc: Text): { defs: Map<string, string>; defLines: string } {
  const defs = new Map<string, string>();
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i += 1) {
    const text = doc.line(i).text;
    const match = refDefLine.exec(text);
    if (match) {
      defs.set(match[1].toLowerCase(), match[2]);
      lines.push(text);
    }
  }
  return { defs, defLines: lines.length ? `\n\n${lines.join('\n')}` : '' };
}

/** นับ fence marker ตั้งแต่ต้นเอกสารถึงบรรทัดก่อน startLine เพื่อรู้ว่า viewport เริ่มต้นตอนอยู่ใน fence หรือไม่ */
function fenceStateBefore(doc: EditorView['state']['doc'], startLine: number): boolean {
  let inFence = false;
  for (let i = 1; i < startLine; i += 1) {
    if (fenceLine.test(doc.line(i).text)) inFence = !inFence;
  }
  return inFence;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selectionRanges = view.state.selection.ranges;
  const decorations: Range<Decoration>[] = [];
  const { defs: referenceDefs } = collectReferenceDefs(view.state.doc);

  for (const { from, to } of view.visibleRanges) {
    let inFence = fenceStateBefore(view.state.doc, view.state.doc.lineAt(from).number);
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const lineActive = cursorTouches(line.from, line.to, selectionRanges);

      if (fenceLine.test(text)) {
        inFence = !inFence;
        pos = line.to + 1;
        continue;
      }

      if (inFence) {
        pos = line.to + 1;
        continue;
      }

      // ตาราง (tableField จัดการแบบ block แยกต่างหาก) และบรรทัดนิยาม reference — ไม่ตกแต่ง inline
      // บรรทัดนิยามมักมี data URL ยาวมาก และมี _/- ที่จะ match pattern ตัวเอียงโดยบังเอิญ
      if (tableRowLine.test(text) || refDefLine.test(text)) {
        pos = line.to + 1;
        continue;
      }

      // Heading — ซ่อน "# " แต่คงระยะไว้ด้วยการจัดฟอนต์ใหญ่ทั้งบรรทัดแทน
      const headingMatch = headingLine.exec(text);
      if (headingMatch && !lineActive) {
        const level = headingMatch[1].length;
        const markerEnd = line.from + headingMatch[0].length;
        decorations.push(Decoration.replace({}).range(line.from, markerEnd));
        decorations.push(
          Decoration.line({ class: `cm-lm-heading cm-lm-heading-${level}` }).range(line.from)
        );
      } else if (headingMatch && lineActive) {
        decorations.push(
          Decoration.line({ class: `cm-lm-heading cm-lm-heading-${headingMatch[1].length} cm-lm-heading-raw` }).range(
            line.from
          )
        );
      }

      // Blockquote — ซ่อน ">" marker, คงการเยื้อง/สไตล์ด้วย line class
      const quoteMatch = quoteMarker.exec(text);
      if (quoteMatch && !lineActive) {
        decorations.push(Decoration.replace({}).range(line.from, line.from + quoteMatch[0].length));
        decorations.push(Decoration.line({ class: 'cm-lm-quote' }).range(line.from));
      } else if (quoteMatch) {
        decorations.push(Decoration.line({ class: 'cm-lm-quote' }).range(line.from));
      }

      // Bullet list — แทนที่ -/*/+ ด้วยจุดกลม (คงแก้ไขได้เมื่อ cursor อยู่บรรทัดนั้น)
      const bulletMatch = bulletMarker.exec(text);
      if (bulletMatch && !lineActive) {
        const markerFrom = line.from + bulletMatch[1].length;
        const markerTo = line.from + bulletMatch[1].length + bulletMatch[2].length;
        decorations.push(
          Decoration.replace({ widget: new BulletWidget(null) }).range(markerFrom, markerTo)
        );
      }

      // Image / Link ต้องมาก่อน inline pattern — URL อาจมี _ หรือ * ที่ pattern ตัวเอียง/หนา
      // จะ match ทับช่วงเดียวกันแล้วได้ replace ซ้อนกัน จึงบันทึกช่วงที่ใช้ไปแล้วไว้กันชน
      const consumed: { from: number; to: number }[] = [];

      // Image — เก็บ syntax ไว้เมื่อแก้ไข, ไม่งั้นแสดงเป็นรูปจริงแทนทั้ง token
      // รองรับทั้ง ![alt](src) และแบบ reference ![alt][id] ที่นิยาม [id]: url ไว้ที่อื่นในเอกสาร
      imagePattern.lastIndex = 0;
      let imageMatch: RegExpExecArray | null;
      while ((imageMatch = imagePattern.exec(text))) {
        const matchFrom = line.from + imageMatch.index;
        const matchTo = matchFrom + imageMatch[0].length;
        consumed.push({ from: matchFrom, to: matchTo });
        if (cursorTouches(matchFrom, matchTo, selectionRanges)) continue;
        decorations.push(
          Decoration.replace({ widget: new ImageWidget(imageMatch[2], imageMatch[1]) }).range(matchFrom, matchTo)
        );
      }

      refImagePattern.lastIndex = 0;
      let refImageMatch: RegExpExecArray | null;
      while ((refImageMatch = refImagePattern.exec(text))) {
        const src = referenceDefs.get(refImageMatch[2].toLowerCase());
        if (!src) continue; // ไม่มีนิยาม — ปล่อย raw ไว้ให้เห็นว่ายังอ้างอิงไม่สำเร็จ
        const matchFrom = line.from + refImageMatch.index;
        const matchTo = matchFrom + refImageMatch[0].length;
        consumed.push({ from: matchFrom, to: matchTo });
        if (cursorTouches(matchFrom, matchTo, selectionRanges)) continue;
        decorations.push(
          Decoration.replace({ widget: new ImageWidget(src, refImageMatch[1]) }).range(matchFrom, matchTo)
        );
      }

      // Link — ซ่อน "[" "](url)" เหลือแค่ text ที่ขีดเส้นใต้ตามสไตล์ลิงก์
      linkPattern.lastIndex = 0;
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkPattern.exec(text))) {
        const matchFrom = line.from + linkMatch.index;
        const matchTo = matchFrom + linkMatch[0].length;
        // ข้ามถ้าทับกับ image ที่จับไปแล้ว (image ก็ match pattern ลิงก์ได้เพราะขึ้นต้นด้วย !)
        if (text[linkMatch.index - 1] === '!') continue;
        consumed.push({ from: matchFrom, to: matchTo });
        const active = cursorTouches(matchFrom, matchTo, selectionRanges);
        const labelFrom = matchFrom + 1;
        const labelTo = labelFrom + linkMatch[1].length;

        if (!active) {
          decorations.push(Decoration.replace({}).range(matchFrom, labelFrom));
          decorations.push(Decoration.replace({}).range(labelTo, matchTo));
        }
        decorations.push(Decoration.mark({ class: 'cm-lm-link' }).range(labelFrom, labelTo));
      }

      // Inline: bold / italic / strikethrough / inline code
      // เก็บ match จากทุก pattern มารวมกันก่อน แล้วตัดตัวที่ทับช่วงกัน (เช่น `code **bold` ปนกัน)
      // หรือทับกับ image/link ข้างบน เพื่อไม่ให้ได้ replace range ที่ overlap กัน
      const inlineMatches: { from: number; to: number; type: string; openLen: number; closeLen: number }[] = [];
      for (const pattern of inlinePatterns) {
        pattern.re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.re.exec(text))) {
          const [openLen, closeLen] = pattern.markerLen(match);
          inlineMatches.push({
            from: line.from + match.index,
            to: line.from + match.index + match[0].length,
            type: pattern.type,
            openLen,
            closeLen
          });
        }
      }
      inlineMatches.sort((a, b) => a.from - b.from || b.to - a.to);

      let lastInlineEnd = -1;
      for (const inlineMatch of inlineMatches) {
        if (inlineMatch.from < lastInlineEnd) continue; // ทับกับ match ก่อนหน้า — ข้าม
        if (consumed.some((range) => inlineMatch.from < range.to && inlineMatch.to > range.from)) continue;
        lastInlineEnd = inlineMatch.to;

        const active = cursorTouches(inlineMatch.from, inlineMatch.to, selectionRanges);
        if (!active) {
          decorations.push(Decoration.replace({}).range(inlineMatch.from, inlineMatch.from + inlineMatch.openLen));
          decorations.push(Decoration.replace({}).range(inlineMatch.to - inlineMatch.closeLen, inlineMatch.to));
        }
        decorations.push(
          Decoration.mark({ class: `cm-lm-${inlineMatch.type}` }).range(
            active ? inlineMatch.from : inlineMatch.from + inlineMatch.openLen,
            active ? inlineMatch.to : inlineMatch.to - inlineMatch.closeLen
          )
        );
      }

      pos = line.to + 1;
    }
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const decoration of decorations) builder.add(decoration.from, decoration.to, decoration.value);
  return builder.finish();
}

// ---------- ตาราง (block-level) ----------
// CodeMirror ไม่อนุญาตให้ ViewPlugin สร้าง decoration คร่อมหลายบรรทัด (block widget)
// จึงต้องใช้ StateField แยก — render ทั้งก้อนด้วย engine เดียวกับ Preview เพื่อให้หน้าตาตรงกันเสมอ
class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly blockFrom: number,
    private readonly needsFix: boolean
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.blockFrom === this.blockFrom && other.needsFix === this.needsFix;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-lm-table markdown-body';
    dom.innerHTML = renderMarkdown(this.source); // ผ่าน DOMPurify ใน renderMarkdown แล้ว

    // ตารางที่ยังไม่สมบูรณ์ (แตกเป็นเศษด้วยบรรทัดว่าง / ไม่มีแถวคั่น) — ให้ปุ่มแก้ตรงจุด
    if (this.needsFix) {
      const from = this.blockFrom;
      const hint = document.createElement('button');
      hint.className = 'cm-lm-table-fix';
      hint.textContent = '⚡ จัดให้เป็นตาราง';
      hint.title = 'ตารางนี้ยังไม่สมบูรณ์ — คลิกเพื่อรวม/เติมแถวคั่นให้ถูกต้อง (หรือกด Ctrl+Shift+T ในตาราง)';
      hint.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const result = fixTableBlock(view.state.doc.toString(), { from, to: from });
        if (!result) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: result.content },
          selection: { anchor: result.selectionStart, head: result.selectionEnd },
          scrollIntoView: true,
          userEvent: 'input'
        });
        view.focus();
      });
      dom.appendChild(hint);
    }
    return dom;
  }
  // คลิกที่ตัวตาราง → ให้ editor รับ event (cursor ย้ายเข้า block → สลับเป็น raw ให้แก้ได้)
  // ยกเว้นคลิกที่ปุ่มแก้ — widget จัดการเอง
  ignoreEvent(event: Event) {
    return event.target instanceof HTMLElement && event.target.closest('.cm-lm-table-fix') !== null;
  }
}

function buildTableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const { defLines } = collectReferenceDefs(doc);
  let inFence = false;

  for (let i = 1; i <= doc.lines; ) {
    const line = doc.line(i);
    if (fenceLine.test(line.text)) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence || !tableRowLine.test(line.text)) {
      i += 1;
      continue;
    }
    let last = i;
    while (last < doc.lines && tableRowLine.test(doc.line(last + 1).text)) last += 1;
    // ต้องมี ≥2 บรรทัดถึงถือเป็นตาราง — บรรทัด | เดี่ยวอาจเป็นตารางที่เพิ่งเริ่มพิมพ์ ปล่อย raw ไว้
    if (last > i) {
      const from = line.from;
      const to = doc.line(last).to;
      const touches = state.selection.ranges.some((range) => range.from <= to && range.to >= from);
      if (!touches) {
        // พ่วงนิยาม reference ให้รูป/ลิงก์ reference-style ในเซลล์แสดงได้ (แบบเดียวกับ hoverPreview)
        const source = doc.sliceString(from, to) + defLines;
        // "เศษตาราง": มีบล็อกแถวตารางอีกก้อนห่างแค่บรรทัดว่างเดียว (ผู้ใช้เผลอเว้นบรรทัด)
        // หรือก้อนนี้เอง render ไม่ออกเป็นตาราง (ไม่มีแถวคั่น) → โชว์ปุ่มแก้ตรงจุด
        const fragmentAbove =
          i > 2 && blankOnly.test(doc.line(i - 1).text) && tableRowLine.test(doc.line(i - 2).text);
        const fragmentBelow =
          last + 2 <= doc.lines && blankOnly.test(doc.line(last + 1).text) && tableRowLine.test(doc.line(last + 2).text);
        const needsFix = fragmentAbove || fragmentBelow || !renderMarkdown(source).includes('<table');
        builder.add(from, to, Decoration.replace({ widget: new TableWidget(source, from, needsFix), block: true }));
      }
    }
    i = last + 1;
  }
  return builder.finish();
}

const tableField = StateField.define<DecorationSet>({
  create: buildTableDecorations,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) return buildTableDecorations(transaction.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

export function liveMarkdown(): Extension {
  return [
    liveMarkdownPlugin,
    tableField,
    EditorView.baseTheme({
      '.cm-lm-heading': { fontWeight: '700' },
      '.cm-lm-heading-1': { fontSize: '1.7em' },
      '.cm-lm-heading-2': { fontSize: '1.4em' },
      '.cm-lm-heading-3': { fontSize: '1.2em' },
      '.cm-lm-heading-4': { fontSize: '1.1em' },
      '.cm-lm-heading-5': { fontSize: '1.05em' },
      '.cm-lm-heading-6': { fontSize: '1em' },
      '.cm-lm-quote': {
        borderLeft: '4px solid var(--accent)',
        paddingLeft: '0.8em',
        color: 'var(--text-soft)'
      },
      '.cm-lm-bold': { fontWeight: '700' },
      '.cm-lm-italic': { fontStyle: 'italic' },
      '.cm-lm-strikethrough': { textDecoration: 'line-through' },
      '.cm-lm-code': {
        fontFamily: 'var(--mono)',
        background: 'var(--bg-soft)',
        padding: '0.1em 0.3em',
        borderRadius: '4px'
      },
      '.cm-lm-link': {
        color: 'var(--accent)',
        textDecoration: 'underline'
      },
      '.cm-lm-bullet': {
        display: 'inline-block',
        width: '1em',
        color: 'var(--text-soft)'
      },
      '.cm-lm-image': {
        maxWidth: '100%',
        maxHeight: '420px',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        verticalAlign: 'middle'
      },
      '.cm-lm-table': {
        padding: '2px 0',
        cursor: 'text'
      },
      '.cm-lm-table table': {
        margin: '4px 0'
      },
      '.cm-lm-table-fix': {
        display: 'inline-block',
        margin: '2px 0 6px',
        padding: '2px 12px',
        fontSize: '11px',
        fontFamily: 'inherit',
        color: 'var(--accent)',
        background: 'var(--accent-soft)',
        border: '1px dashed var(--accent)',
        borderRadius: '999px',
        cursor: 'pointer'
      }
    })
  ];
}
