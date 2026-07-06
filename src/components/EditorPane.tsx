import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useDocStore } from '../store/docStore';
import { useSettingsStore } from '../store/settingsStore';
import type { EditorApi } from '../types';
import { collapseDataUrls } from './editor/collapseDataUrls';
import { floatingToolbar } from './editor/floatingToolbar';
import { hoverPreview } from './editor/hoverPreview';
import { liveMarkdown } from './editor/liveMarkdown';
import { attachPasteDrop } from './editor/pasteDrop';
import { slashMenu } from './editor/slashMenu';
import { smartFormatExtension } from './editor/smartFormatExtension';

function getCursorPosition(content: string, offset: number) {
  const before = content.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// CodeMirror เลือก tooltip theme (พื้นขาว/พื้นดำ) จาก dark flag ตอนสร้าง theme() เอง
// ไม่ได้อ่านจาก CSS variable — ต้องบอกมันตรงๆ ว่าตอนนี้ธีมแอปเป็นมืดหรือไม่
function resolveIsDark(theme: string): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function editorTheme(dark: boolean) {
  return EditorView.theme(
    {
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
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'var(--accent-soft) !important'
      },
      '&.cm-focused .cm-selectionMatch': {
        backgroundColor: 'var(--accent-soft)'
      }
    },
    { dark }
  );
}

interface EditorPaneProps {
  fullMode?: boolean;
}

export const EditorPane = forwardRef<EditorApi, EditorPaneProps>(({ fullMode = false }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const liveMarkdownCompartmentRef = useRef(new Compartment());
  const content = useDocStore((state) => state.content);
  const fileName = useDocStore((state) => state.file.name);
  const setContent = useDocStore((state) => state.setContent);
  const setCursor = useDocStore((state) => state.setCursor);
  const appTheme = useSettingsStore((state) => state.theme);

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
      liveMarkdownCompartmentRef.current.of(fullMode ? liveMarkdown() : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setContent(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const cursor = update.state.selection.main.head;
          setCursor(getCursorPosition(update.state.doc.toString(), cursor));
        }
      }),
      themeCompartmentRef.current.of(editorTheme(resolveIsDark(useSettingsStore.getState().theme)))
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
    const view = viewRef.current;
    if (!view) return;
    const applyDark = (dark: boolean) =>
      view.dispatch({ effects: themeCompartmentRef.current.reconfigure(editorTheme(dark)) });

    applyDark(resolveIsDark(appTheme));
    if (appTheme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => applyDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [appTheme]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    return attachPasteDrop(root, () => viewRef.current);
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: liveMarkdownCompartmentRef.current.reconfigure(fullMode ? liveMarkdown() : [])
    });
  }, [fullMode]);

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
