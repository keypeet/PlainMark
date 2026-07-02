// Floating Toolbar — แถบเครื่องมือลอยเหนือข้อความที่เลือก (advanced_features.md ข้อ 4)
// ใช้ระบบ tooltip ของ CodeMirror: ตำแหน่งเกาะ selection และเลื่อนตาม scroll ให้เอง
import { EditorState, StateField, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, Tooltip } from '@codemirror/view';
import { toggleHeading, wrapSelection } from '../../lib/formatActions';
import type { FormatResult } from '../../types';

type FloatingActionId = 'bold' | 'italic' | 'link' | 'code' | 'heading';

interface FloatingAction {
  id: FloatingActionId;
  label: string;
  title: string;
}

const actions: FloatingAction[] = [
  { id: 'bold', label: 'B', title: 'Bold (Ctrl+B)' },
  { id: 'italic', label: 'I', title: 'Italic (Ctrl+I)' },
  { id: 'link', label: '🔗', title: 'Link (Ctrl+K)' },
  { id: 'code', label: '</>', title: 'Inline Code (Ctrl+E)' },
  { id: 'heading', label: 'H1', title: 'Heading (Ctrl+1)' }
];

function runAction(id: FloatingActionId, content: string, selection: { from: number; to: number }): FormatResult | null {
  switch (id) {
    case 'bold':
      return wrapSelection(content, selection, '**', '**', 'bold text');
    case 'italic':
      return wrapSelection(content, selection, '*', '*', 'italic text');
    case 'code':
      return wrapSelection(content, selection, '`', '`', 'code');
    case 'link': {
      const url = window.prompt('วางลิงก์ (URL):', 'https://');
      if (!url || url === 'https://') return null;
      const text = content.slice(selection.from, selection.to) || 'link text';
      return {
        content: content.slice(0, selection.from) + `[${text}](${url.trim()})` + content.slice(selection.to),
        selectionStart: selection.from + 1,
        selectionEnd: selection.from + 1 + text.length
      };
    }
    case 'heading':
      return toggleHeading(content, selection, 1);
  }
}

function applyAction(view: EditorView, id: FloatingActionId): void {
  const selection = view.state.selection.main;
  const result = runAction(id, view.state.doc.toString(), { from: selection.from, to: selection.to });
  if (!result) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.content },
    selection: { anchor: result.selectionStart, head: result.selectionEnd },
    scrollIntoView: true,
    userEvent: 'input'
  });
  view.focus();
}

function buildToolbar(view: EditorView): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'cm-floating-toolbar';
  for (const action of actions) {
    const button = document.createElement('button');
    button.className = `floating-tool floating-tool-${action.id}`;
    button.textContent = action.label;
    button.title = action.title;
    // ใช้ mousedown กัน editor เสีย focus/selection ก่อนคำสั่งทำงาน
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      applyAction(view, action.id);
    });
    bar.appendChild(button);
  }
  return bar;
}

function selectionTooltip(state: EditorState): Tooltip | null {
  const range = state.selection.main;
  // โผล่เฉพาะตอนเลือกข้อความจริง (ลาก/ดับเบิลคลิก) — cursor เฉยๆ ไม่ต้อง
  if (range.empty) return null;
  return {
    pos: Math.min(range.from, range.to),
    above: true,
    strictSide: false,
    arrow: false,
    create: (view) => ({ dom: buildToolbar(view) })
  };
}

const floatingToolbarField = StateField.define<Tooltip | null>({
  create: (state) => selectionTooltip(state),
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    return selectionTooltip(transaction.state);
  },
  provide: (field) => showTooltip.from(field)
});

export function floatingToolbar(): Extension {
  return floatingToolbarField;
}
