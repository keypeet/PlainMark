// ส่วนต่อ Smart Auto-format เข้ากับ CodeMirror — กติกาจริงอยู่ใน lib/smartFormat.ts
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { enterActionForLine, expandShorthand } from '../../lib/smartFormat';

function handleEnter(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  // มี selection หรือ cursor ไม่อยู่ท้ายบรรทัด → ปล่อยให้ Enter ปกติ
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return false;

  const action = enterActionForLine(line.text);
  if (action.kind === 'none') return false;

  if (action.kind === 'exit') {
    // ลบ marker ว่างทิ้ง เหลือบรรทัดเปล่า = ออกจาก list
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
      scrollIntoView: true,
      userEvent: 'input'
    });
    return true;
  }

  const insert = `\n${action.marker}`;
  view.dispatch({
    changes: { from: selection.head, insert },
    selection: { anchor: selection.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input'
  });
  return true;
}

// เคาะ space หลัง shorthand (เช่น "[]") → ขยายเป็น Markdown เต็ม
function handleSpace(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const beforeCursor = state.doc.sliceString(line.from, selection.head);

  const expansion = expandShorthand(beforeCursor);
  if (!expansion) return false;

  const from = line.from + expansion.replaceFrom;
  view.dispatch({
    changes: { from, to: selection.head, insert: expansion.insert },
    selection: { anchor: from + expansion.insert.length },
    scrollIntoView: true,
    userEvent: 'input'
  });
  return true;
}

export function smartFormatExtension(): Extension {
  return keymap.of([
    { key: 'Enter', run: handleEnter },
    { key: 'Space', run: handleSpace }
  ]);
}
