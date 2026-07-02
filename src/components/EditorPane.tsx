import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  lineNumbers
} from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { insertReferenceLink, longUrlThreshold } from '../lib/formatActions';
import { embedImageReference, isImageFile, readImageAsDataUrl } from '../lib/imagePaste';
import { convertClipboardHtml } from '../lib/pasteConvert';
import { useDocStore } from '../store/docStore';
import type { EditorApi } from '../types';
import { floatingToolbar } from './editor/floatingToolbar';
import { hoverPreview } from './editor/hoverPreview';
import { slashMenu } from './editor/slashMenu';
import { smartFormatExtension } from './editor/smartFormatExtension';

function getCursorPosition(content: string, offset: number) {
  const before = content.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// พับ data URL ของรูป base64 ให้เห็นเป็นชิปสั้นๆ แทนตัวอักษรยาวหลายหมื่นตัว (ข้อมูลจริงในไฟล์ยังครบ)
class DataUrlChip extends WidgetType {
  constructor(
    private readonly mime: string,
    private readonly sizeLabel: string
  ) {
    super();
  }

  eq(other: DataUrlChip): boolean {
    return other.mime === this.mime && other.sizeLabel === this.sizeLabel;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cm-image-chip';
    chip.textContent = `🖼 ${this.mime} · ${this.sizeLabel}`;
    chip.title = 'รูปภาพ base64 (ถูกย่อการแสดงผล — ข้อมูลจริงยังอยู่ในไฟล์)';
    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const dataUrlDecorator = new MatchDecorator({
  regexp: /data:(image\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]{40,}/gi,
  decoration: (match) => {
    const bytes = Math.round((match[0].length - match[0].indexOf(',') - 1) * 0.75);
    const sizeLabel = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return Decoration.replace({ widget: new DataUrlChip(match[1], sizeLabel) });
  }
});

const collapseDataUrls = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = dataUrlDecorator.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = dataUrlDecorator.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
  }
);

export const EditorPane = forwardRef<EditorApi>((_, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const content = useDocStore((state) => state.content);
  const fileName = useDocStore((state) => state.file.name);
  const setContent = useDocStore((state) => state.setContent);
  const setCursor = useDocStore((state) => state.setCursor);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    getSelection: () => {
      const selection = viewRef.current?.state.selection.main;
      return { from: selection?.from ?? 0, to: selection?.to ?? 0 };
    },
    replaceContent: (nextContent, selectionStart, selectionEnd) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextContent },
        selection:
          selectionStart === undefined
            ? undefined
            : { anchor: selectionStart, head: selectionEnd ?? selectionStart },
        scrollIntoView: true
      });
    }
  }));

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const extensions = [
      lineNumbers(),
      history(),
      markdown(),
      smartFormatExtension(), // ต้องมาก่อน defaultKeymap เพื่อดัก Enter/Space บนบรรทัด list
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      collapseDataUrls,
      slashMenu(),
      floatingToolbar(),
      hoverPreview(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setContent(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const cursor = update.state.selection.main.head;
          setCursor(getCursorPosition(update.state.doc.toString(), cursor));
        }
      }),
      EditorView.theme({
        '&': {
          height: '100%',
          backgroundColor: 'var(--editor-bg)',
          color: 'var(--text)'
        },
        '.cm-content': {
          fontFamily: 'var(--mono)',
          fontSize: '13.5px',
          lineHeight: '1.7',
          padding: '14px 16px',
          caretColor: 'var(--text)'
        },
        '.cm-gutters': {
          backgroundColor: 'var(--bg-soft)',
          color: 'var(--text-soft)',
          borderRight: '1px solid var(--border)'
        },
        '.cm-activeLineGutter, .cm-activeLine': {
          backgroundColor: 'var(--active-line)'
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--text)',
          borderLeftWidth: '2px'
        },
        '.cm-focused': {
          outline: 'none'
        }
      })
    ];

    const state = EditorState.create({ doc: content, extensions });
    viewRef.current = new EditorView({ state, parent: containerRef.current });
    viewRef.current.focus();

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [setContent, setCursor]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
  }, [content]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const imageUrlPattern = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?\S*)?$/i;

    const handlePaste = async (event: ClipboardEvent) => {
      const view = viewRef.current;
      if (!view) return;

      const item = Array.from(event.clipboardData?.items ?? []).find((clipboardItem) =>
        clipboardItem.type.startsWith('image/')
      );
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        const dataUrl = await readImageAsDataUrl(file);
        const result = embedImageReference(view.state.doc.toString(), view.state.selection.main.from, dataUrl);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: result.content },
          selection: { anchor: result.selectionStart },
          scrollIntoView: true
        });
        return;
      }

      const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
      const isBareUrl = /^https?:\/\/\S+$/.test(text);

      // Paste Anything: HTML จาก Word/Excel/เว็บ → แปลงเป็น Markdown (ตาราง Excel → Markdown Table)
      // ยกเว้น URL เปล่า — ให้ตกไปเข้ากติกาย่อลิงก์ด้านล่างแทน
      if (!isBareUrl) {
        const html = event.clipboardData?.getData('text/html');
        const markdownFromHtml = convertClipboardHtml(html);
        if (markdownFromHtml) {
          event.preventDefault();
          const selection = view.state.selection.main;
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: markdownFromHtml },
            selection: { anchor: selection.from + markdownFromHtml.length },
            scrollIntoView: true,
            userEvent: 'input.paste'
          });
          return;
        }
      }

      // วาง URL ยาวเดี่ยวๆ → ย่อเป็น reference-style อัตโนมัติ ไม่ให้รก editor
      if (isBareUrl && text.length > longUrlThreshold) {
        event.preventDefault();
        const selection = view.state.selection.main;
        const kind = imageUrlPattern.test(text) ? 'image' : 'link';
        const result = insertReferenceLink(
          view.state.doc.toString(),
          { from: selection.from, to: selection.to },
          text,
          kind
        );
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: result.content },
          selection: { anchor: result.selectionStart },
          scrollIntoView: true
        });
      }
    };

    const handleDragOver = (event: DragEvent) => {
      const hasImage = Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith('image/'));
      if (hasImage) {
        event.preventDefault();
        root.classList.add('is-dragging-image');
      }
    };

    const handleDragLeave = () => {
      root.classList.remove('is-dragging-image');
    };

    const handleDrop = async (event: DragEvent) => {
      root.classList.remove('is-dragging-image');
      const file = Array.from(event.dataTransfer?.files ?? []).find(isImageFile);
      const view = viewRef.current;
      if (!file || !view) return;
      event.preventDefault();
      const dataUrl = await readImageAsDataUrl(file);
      const result = embedImageReference(view.state.doc.toString(), view.state.selection.main.from, dataUrl);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: result.content },
        selection: { anchor: result.selectionStart },
        scrollIntoView: true
      });
    };

    root.addEventListener('paste', handlePaste);
    root.addEventListener('dragover', handleDragOver);
    root.addEventListener('dragleave', handleDragLeave);
    root.addEventListener('drop', handleDrop);

    return () => {
      root.removeEventListener('paste', handlePaste);
      root.removeEventListener('dragover', handleDragOver);
      root.removeEventListener('dragleave', handleDragLeave);
      root.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <section className="pane editor-pane">
      <div className="pane-header">
        <span className="dot" />
        Editor - {fileName}
      </div>
      <div ref={containerRef} className="editor-host" />
    </section>
  );
});

EditorPane.displayName = 'EditorPane';
