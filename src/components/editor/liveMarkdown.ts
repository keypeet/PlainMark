// Live Markdown (โหมด Full) — แสดงผลจัดฟอร์แมตทับ syntax markdown ในบรรทัดเดียวกับที่พิมพ์
// แนวคิดแบบ Typora: ซ่อนสัญลักษณ์ (**, #, `) ยกเว้นบรรทัด/ช่วงที่ cursor อยู่ ซึ่งจะโชว์ raw text ให้แก้ไขได้ปกติ
import type { EditorState, Extension, Range, Text } from '@codemirror/state';
import { Facet, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { renderMarkdown } from '../../lib/markdownEngine';
import { hasTauri, tauriCore, tauriPath } from '../../lib/platform';
import { fixTableBlock, isSeparatorRow, parseCells, tableRowOf } from '../../lib/tableFormat';

// path ของเอกสารปัจจุบัน — ใช้ resolve รูป relative (เช่น note.assets/…) แบบเดียวกับ useRenderedMarkdown
const documentPathFacet = Facet.define<string | null, string | null>({
  combine: (values) => (values.length ? values[0] : null)
});

/** ตั้ง src ให้ <img> — path relative ต้องแปลงผ่าน convertFileSrc ของ Tauri ไม่งั้นรูปที่วางไว้ข้างไฟล์จะไม่ขึ้น */
function assignImageSrc(img: HTMLImageElement, src: string, documentPath: string | null) {
  if (!hasTauri || !documentPath || /^(?:[a-z][a-z+.-]*:|\/)/i.test(src)) {
    img.src = src;
    return;
  }
  void Promise.all([tauriPath(), tauriCore()]).then(async ([{ dirname, join }, { convertFileSrc }]) => {
    img.src = convertFileSrc(await join(await dirname(documentPath), decodeURIComponent(src)));
  });
}

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
  toDOM(view: EditorView) {
    const img = document.createElement('img');
    assignImageSrc(img, this.src, view.state.facet(documentPathFacet));
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
// เซลล์ (th/td) แก้ไขได้โดยตรงแบบ Notepad/Typora: พิมพ์ลงช่องแล้ว sync กลับเป็น markdown ให้อัตโนมัติ

/** escape เฉพาะ | ที่ผู้ใช้พิมพ์เอง (ตัวที่ escape อยู่แล้วปล่อยไว้) กันเซลล์แตกเป็นคอลัมน์ใหม่ */
const escapeCellPipes = (cell: string) => cell.replace(/(?<!\\)\|/g, '\\|');

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** ขอบเขตบล็อกตารางของ widget ณ ตอนนี้ — ตำแหน่งเลื่อนได้เมื่อแก้ข้อความเหนือขึ้นไป จึงหาสดจาก DOM เสมอ */
function tableBlockRange(view: EditorView, dom: HTMLElement): { from: number; to: number } | null {
  if (!dom.isConnected) return null;
  let pos: number;
  try {
    pos = view.posAtDOM(dom);
  } catch {
    return null;
  }
  const doc = view.state.doc;
  const first = doc.lineAt(pos);
  if (!tableRowLine.test(first.text)) return null;
  let last = first.number;
  while (last < doc.lines && tableRowLine.test(doc.line(last + 1).text)) last += 1;
  return { from: first.from, to: doc.line(last).to };
}

/** โฟกัสช่องแรกของตารางที่ตำแหน่ง pos — ใช้หลังแทรกตารางใหม่ให้พิมพ์ต่อได้เลย (ไม่เจอตารางก็เงียบไป) */
export function focusFirstTableCellAt(view: EditorView, pos: number) {
  focusCellIn(view, pos, 0, 0);
}

/** หา widget ตารางที่ตำแหน่ง pos แล้วโฟกัสเซลล์ (ใช้หลังเพิ่มแถวใหม่ ซึ่งต้องสร้าง DOM ใหม่ทั้งก้อน) */
function focusCellIn(view: EditorView, pos: number, rowIndex: number, colIndex: number) {
  for (const el of Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-lm-table'))) {
    try {
      if (view.posAtDOM(el) !== pos) continue;
    } catch {
      continue;
    }
    const cell = el.querySelectorAll('tr')[rowIndex]?.children[colIndex];
    if (cell instanceof HTMLElement) {
      cell.focus();
      placeCaretAtEnd(cell);
    }
    return;
  }
}

/** แสดงผล markdown ของเนื้อเซลล์ (ตอนไม่ได้แก้) — แนบนิยาม reference ให้รูป/ลิงก์แบบ ![a][id] ออกด้วย */
function renderCellMarkdown(cell: HTMLElement, defLines: string, documentPath: string | null) {
  const holder = document.createElement('div');
  holder.innerHTML = renderMarkdown((cell.dataset.raw ?? '') + defLines); // ผ่าน DOMPurify แล้ว
  const paragraph = holder.querySelector('p');
  cell.innerHTML = paragraph ? paragraph.innerHTML : '';
  if (!paragraph) cell.textContent = holder.textContent ?? '';
  for (const img of cell.querySelectorAll('img')) {
    const source = img.getAttribute('src');
    if (source) assignImageSrc(img, source, documentPath);
  }
}

class TableWidget extends WidgetType {
  constructor(
    private readonly block: string, // ข้อความตารางดิบในเอกสาร (ไม่รวมนิยาม reference ที่พ่วงตอน render)
    private readonly defLines: string,
    private readonly needsFix: boolean
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.block === this.block && other.defLines === this.defLines && other.needsFix === this.needsFix;
  }
  // เนื้อหาใหม่คือสิ่งที่กริดของ widget นี้เพิ่ง commit ลงเอกสารเอง → DOM มีข้อความล่าสุดอยู่แล้ว
  // เก็บ DOM เดิมไว้เพื่อไม่ให้ focus/caret ในเซลล์หลุดระหว่างพิมพ์ (การแก้จากภายนอกยัง render ใหม่ปกติ)
  updateDOM(dom: HTMLElement) {
    if (dom.dataset.pmExpected === this.block) {
      delete dom.dataset.pmExpected;
      return true;
    }
    return false;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-lm-table markdown-body';
    dom.innerHTML = renderMarkdown(this.block + this.defLines); // ผ่าน DOMPurify ใน renderMarkdown แล้ว

    // รูปในเซลล์ตารางก็ต้อง resolve path relative เหมือนรูปเดี่ยว
    const documentPath = view.state.facet(documentPathFacet);
    for (const img of dom.querySelectorAll('img')) {
      const source = img.getAttribute('src');
      if (source) assignImageSrc(img, source, documentPath);
    }

    // ตารางที่ยังไม่สมบูรณ์ (แตกเป็นเศษด้วยบรรทัดว่าง / ไม่มีแถวคั่น) — ให้ปุ่มแก้ตรงจุด
    if (this.needsFix) {
      const hint = document.createElement('button');
      hint.className = 'cm-lm-table-fix';
      hint.textContent = '⚡ จัดให้เป็นตาราง';
      hint.title = 'ตารางนี้ยังไม่สมบูรณ์ — คลิกเพื่อรวม/เติมแถวคั่นให้ถูกต้อง (หรือกด Ctrl+Shift+T ในตาราง)';
      hint.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const range = tableBlockRange(view, dom);
        if (!range) return;
        const result = fixTableBlock(view.state.doc.toString(), { from: range.from, to: range.from });
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

    // ปุ่มสลับไปแก้เป็นข้อความ markdown (โผล่ตอน hover) — ไว้เพิ่ม/ลบแถว-คอลัมน์แบบอิสระ
    const rawButton = document.createElement('button');
    rawButton.className = 'cm-lm-table-raw';
    rawButton.textContent = 'แก้ md';
    rawButton.title = 'แก้ตารางเป็นข้อความ markdown (เพิ่ม/ลบแถว-คอลัมน์ได้อิสระ)';
    rawButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const range = tableBlockRange(view, dom);
      if (!range) return;
      view.dispatch({ selection: { anchor: range.from }, scrollIntoView: true });
      view.focus();
    });
    dom.appendChild(rawButton);

    this.attachCellEditing(dom, view, documentPath);
    return dom;
  }

  /** ผูกการแก้ไขในช่อง: คลิกเซลล์แล้วพิมพ์ได้เลย, Tab/Enter เดินช่อง, Tab/Enter ท้ายตาราง = เพิ่มแถว */
  private attachCellEditing(dom: HTMLElement, view: EditorView, documentPath: string | null) {
    const table = dom.querySelector('table');
    if (!table) return;

    const dataRows = this.block
      .split('\n')
      .map(parseCells)
      .filter((cells) => !isSeparatorRow(cells));
    const domRows = Array.from(table.querySelectorAll('tr'));
    const columns = dataRows[0]?.length ?? 0;
    // โครง DOM ต้องตรงกับ markdown แถวต่อแถว เซลล์ต่อเซลล์ ไม่งั้นการ sync กลับอาจกินข้อมูล
    // (เช่น แถวที่เซลล์เกินหัวตารางจะถูกตัดทิ้งตอน render) — กรณีนั้นปล่อยเป็นตารางอ่านอย่างเดียว
    if (columns === 0 || domRows.length !== dataRows.length || dataRows.some((cells) => cells.length !== columns)) {
      return;
    }

    const cellsOf = (row: Element) =>
      Array.from(row.children).filter((cell): cell is HTMLElement => cell instanceof HTMLElement);
    const defLines = this.defLines;

    // เขียนสถานะกริดกลับลงเอกสาร: แถวที่เนื้อไม่เปลี่ยนคงบรรทัดเดิมไว้ (ไม่ไปยุ่ง padding ที่จัดสวยแล้ว)
    // appendRow = เพิ่มแถวเปล่าต่อท้าย (ต้อง render DOM ใหม่ แล้วค่อยย้าย focus ไปแถวใหม่)
    const commitGrid = (appendRow = false, focusCol = 0) => {
      const range = tableBlockRange(view, dom);
      if (!range) return;
      const doc = view.state.doc;
      const currentBlock = doc.sliceString(range.from, range.to);
      let rowIndex = 0;
      const nextLines = currentBlock.split('\n').map((line) => {
        if (isSeparatorRow(parseCells(line))) return line;
        const domRow = domRows[rowIndex++];
        if (!domRow) return line;
        const raws = cellsOf(domRow).map((cell) => escapeCellPipes((cell.dataset.raw ?? '').trim()));
        const parsed = parseCells(line);
        const changed = raws.length !== parsed.length || raws.some((raw, index) => raw !== parsed[index]);
        return changed ? `| ${raws.join(' | ')} |` : line;
      });
      if (appendRow) nextLines.push(tableRowOf(columns, '   '));
      const nextBlock = nextLines.join('\n');
      if (nextBlock === currentBlock) return;
      if (!appendRow) dom.dataset.pmExpected = nextBlock;
      view.dispatch({ changes: { from: range.from, to: range.to, insert: nextBlock }, userEvent: 'input' });
      if (appendRow) requestAnimationFrame(() => focusCellIn(view, range.from, domRows.length, focusCol));
    };

    domRows.forEach((domRow, rowIndex) => {
      cellsOf(domRow).forEach((cell, colIndex) => {
        cell.dataset.raw = dataRows[rowIndex][colIndex];
        try {
          cell.contentEditable = 'plaintext-only'; // กัน browser แทรกแท็ก HTML (bold/สี) ที่จะหายตอน sync
        } catch {
          cell.contentEditable = 'true';
        }
        cell.spellcheck = false;

        cell.addEventListener('focus', () => {
          if (cell.dataset.editing) return;
          cell.dataset.editing = '1';
          const raw = cell.dataset.raw ?? '';
          // เซลล์ข้อความล้วน (แสดงผลตรงกับ raw อยู่แล้ว) ไม่ต้องสลับ — caret คงอยู่ตรงจุดที่คลิก
          if (cell.textContent !== raw) {
            cell.textContent = raw;
            placeCaretAtEnd(cell);
          }
        });

        cell.addEventListener('input', () => {
          cell.dataset.raw = (cell.textContent ?? '').replace(/\s*\n\s*/g, ' ');
          commitGrid();
        });

        cell.addEventListener('blur', () => {
          delete cell.dataset.editing;
          commitGrid(); // เผื่อกรณีสุดท้ายยังไม่ได้เขียน (ปกติ input เขียนไปแล้ว — ซ้ำก็ no-op)
          renderCellMarkdown(cell, defLines, documentPath);
        });

        cell.addEventListener('keydown', (event) => {
          const key = event.key.toLowerCase();
          if ((event.ctrlKey || event.metaKey) && key === 's') return; // ปล่อย Ctrl+S ให้แอปบันทึกตามปกติ
          event.stopPropagation(); // กัน keymap ของ editor (Enter/Ctrl+B ฯลฯ) ทำงานทับตอนพิมพ์ในเซลล์
          if (event.key === 'Escape') {
            event.preventDefault();
            cell.blur();
            view.focus();
            return;
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            const flat = domRows.flatMap(cellsOf);
            const target = flat[flat.indexOf(cell) + (event.shiftKey ? -1 : 1)];
            if (target) {
              target.focus();
              placeCaretAtEnd(target);
            } else if (!event.shiftKey) {
              commitGrid(true, 0); // Tab ที่เซลล์สุดท้าย = เพิ่มแถวใหม่ (พิมพ์ต่อยาวๆ ได้ไม่สะดุด)
            }
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const below = domRows[rowIndex + 1] ? cellsOf(domRows[rowIndex + 1])[colIndex] : undefined;
            if (below) {
              below.focus();
              placeCaretAtEnd(below);
            } else {
              commitGrid(true, colIndex); // Enter ที่แถวสุดท้าย = เพิ่มแถวใหม่คอลัมน์เดิม
            }
          }
        });
      });
    });
  }

  // เซลล์และปุ่มบน widget จัดการ event เอง — ที่เหลือ (ขอบตาราง) ปล่อยให้ editor รับ
  // (cursor ย้ายเข้า block → สลับเป็นข้อความ raw ให้แก้โครงตารางได้)
  ignoreEvent(event: Event) {
    if (!(event.target instanceof HTMLElement)) return false;
    return event.target.closest('.cm-lm-table-fix, .cm-lm-table-raw, th, td') !== null;
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
        const block = doc.sliceString(from, to);
        // "เศษตาราง": มีบล็อกแถวตารางอีกก้อนห่างแค่บรรทัดว่างเดียว (ผู้ใช้เผลอเว้นบรรทัด)
        // หรือก้อนนี้เอง render ไม่ออกเป็นตาราง (ไม่มีแถวคั่น) → โชว์ปุ่มแก้ตรงจุด
        const fragmentAbove =
          i > 2 && blankOnly.test(doc.line(i - 1).text) && tableRowLine.test(doc.line(i - 2).text);
        const fragmentBelow =
          last + 2 <= doc.lines && blankOnly.test(doc.line(last + 1).text) && tableRowLine.test(doc.line(last + 2).text);
        const needsFix = fragmentAbove || fragmentBelow || !renderMarkdown(block + defLines).includes('<table');
        builder.add(from, to, Decoration.replace({ widget: new TableWidget(block, defLines, needsFix), block: true }));
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

export function liveMarkdown(documentPath: string | null = null): Extension {
  return [
    documentPathFacet.of(documentPath),
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
        position: 'relative',
        padding: '2px 0',
        cursor: 'text',
        // .cm-content เป็น pre-wrap — ถ้าไม่ reset ตัวขึ้นบรรทัดระหว่างแท็กใน HTML ตาราง
        // จะกลายเป็นช่องว่างจริง ทำให้หัวตารางหลุดจากตัวและมีร่องคั่นทุกช่อง
        whiteSpace: 'normal'
      },
      '.cm-lm-table table': {
        margin: '4px 0'
      },
      // เซลล์แก้ไขได้ — ช่องว่างก็ต้องกว้าง/สูงพอให้คลิกเข้าไปพิมพ์ได้
      '.cm-lm-table th, .cm-lm-table td': {
        minWidth: '3.5em',
        height: '2.1em',
        cursor: 'text'
      },
      '.cm-lm-table th:focus, .cm-lm-table td:focus': {
        outline: '2px solid var(--accent)',
        outlineOffset: '-2px',
        background: 'var(--accent-soft)'
      },
      '.cm-lm-table-raw': {
        position: 'absolute',
        top: '6px',
        right: '4px',
        padding: '1px 8px',
        fontSize: '10px',
        fontFamily: 'inherit',
        color: 'var(--text-soft)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        cursor: 'pointer',
        opacity: '0',
        transition: 'opacity 0.15s'
      },
      '.cm-lm-table:hover .cm-lm-table-raw': {
        opacity: '1'
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
