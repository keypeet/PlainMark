import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useDocStore } from '../store/docStore';
import { useSettingsStore } from '../store/settingsStore';
import type { EditorApi, SearchStats, ViewMode } from '../types';
import { collapseDataUrls } from './editor/collapseDataUrls';
import { focusFirstTableCellAt, liveMarkdown } from './editor/liveMarkdown';
import { attachPasteDrop } from './editor/pasteDrop';
import {
  findMatches,
  searchConfigField,
  searchHighlightExtension,
  setSearchConfigEffect
} from './editor/searchExtension';
import { smartFormatExtension } from './editor/smartFormatExtension';

function getCursorPosition(content: string, offset: number) {
  const before = content.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function resolveIsDark(theme: string): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function editorTheme(dark: boolean, viewMode: ViewMode) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--text)'
      },
      '.cm-scroller': {
        fontFamily: viewMode === 'formatted' ? 'var(--sans)' : 'var(--mono)'
      },
      '.cm-content': {
        fontFamily: viewMode === 'formatted' ? 'var(--sans)' : 'var(--mono)',
        fontSize: 'calc(14.5px * var(--editor-zoom, 1))',
        lineHeight: viewMode === 'formatted' ? '1.78' : '1.68',
        padding: viewMode === 'formatted' ? '22px max(28px, calc((100% - 860px) / 2)) 72px' : '14px 18px 64px',
        caretColor: 'var(--text)'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-soft)',
        color: 'var(--text-soft)',
        borderRight: '1px solid var(--border)',
        fontSize: 'calc(12.5px * var(--editor-zoom, 1))'
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
  tabId: string;
  documentPath: string | null;
  viewMode: ViewMode;
}

const scrollPositions = new Map<string, number>();

export const EditorPane = forwardRef<EditorApi, EditorPaneProps>(({ tabId, documentPath, viewMode }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const liveMarkdownCompartmentRef = useRef(new Compartment());
  const lineNumbersCompartmentRef = useRef(new Compartment());
  const wrapCompartmentRef = useRef(new Compartment());
  const historyCompartmentRef = useRef(new Compartment());
  const lastTabIdRef = useRef<string>(tabId);

  const content = useDocStore((state) => state.content);
  const setContent = useDocStore((state) => state.setContent);
  const setCursor = useDocStore((state) => state.setCursor);
  const appTheme = useSettingsStore((state) => state.theme);
  const showLineNumbers = useSettingsStore((state) => state.showLineNumbers);
  const wordWrap = useSettingsStore((state) => state.wordWrap);

  const applySearchSelection = (view: EditorView, query: string, matchCase: boolean, targetIndex: number): SearchStats => {
    const docText = view.state.doc.toString();
    const matches = findMatches(docText, query, matchCase);
    if (!matches.length) {
      view.dispatch({ effects: setSearchConfigEffect.of({ query, matchCase, activeIndex: -1 }) });
      return { total: 0, current: 0 };
    }
    const wrapped = ((targetIndex % matches.length) + matches.length) % matches.length;
    const match = matches[wrapped];
    view.dispatch({
      effects: setSearchConfigEffect.of({ query, matchCase, activeIndex: wrapped }),
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true
    });
    return { total: matches.length, current: wrapped + 1 };
  };

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
    },
    focusTableCellAt: (pos) => {
      const view = viewRef.current;
      if (!view) return;
      requestAnimationFrame(() => focusFirstTableCellAt(view, pos));
    },
    goToLine: (lineNumber) => {
      const view = viewRef.current;
      if (!view) return false;
      const totalLines = view.state.doc.lines;
      if (!Number.isFinite(lineNumber) || lineNumber < 1 || lineNumber > totalLines) return false;
      const line = view.state.doc.line(Math.floor(lineNumber));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
      return true;
    },
    setSearch: (query, matchCase) => {
      const view = viewRef.current;
      if (!view) return { total: 0, current: 0 };
      if (!query) {
        view.dispatch({ effects: setSearchConfigEffect.of({ query: '', matchCase, activeIndex: -1 }) });
        return { total: 0, current: 0 };
      }
      const docText = view.state.doc.toString();
      const matches = findMatches(docText, query, matchCase);
      if (!matches.length) {
        view.dispatch({ effects: setSearchConfigEffect.of({ query, matchCase, activeIndex: -1 }) });
        return { total: 0, current: 0 };
      }
      const cursor = view.state.selection.main.from;
      const nextIdx = Math.max(0, matches.findIndex((m) => m.from >= cursor));
      return applySearchSelection(view, query, matchCase, nextIdx);
    },
    findNext: () => {
      const view = viewRef.current;
      if (!view) return { total: 0, current: 0 };
      const cfg = view.state.field(searchConfigField);
      if (!cfg.query) return { total: 0, current: 0 };
      return applySearchSelection(view, cfg.query, cfg.matchCase, cfg.activeIndex + 1);
    },
    findPrev: () => {
      const view = viewRef.current;
      if (!view) return { total: 0, current: 0 };
      const cfg = view.state.field(searchConfigField);
      if (!cfg.query) return { total: 0, current: 0 };
      return applySearchSelection(view, cfg.query, cfg.matchCase, cfg.activeIndex - 1);
    },
    replaceCurrent: (replacement) => {
      const view = viewRef.current;
      if (!view) return { total: 0, current: 0 };
      const cfg = view.state.field(searchConfigField);
      if (!cfg.query) return { total: 0, current: 0 };
      const matches = findMatches(view.state.doc.toString(), cfg.query, cfg.matchCase);
      if (!matches.length) return { total: 0, current: 0 };
      const idx = cfg.activeIndex >= 0 && cfg.activeIndex < matches.length ? cfg.activeIndex : 0;
      const match = matches[idx];
      view.dispatch({
        changes: { from: match.from, to: match.to, insert: replacement },
        selection: { anchor: match.from + replacement.length },
        scrollIntoView: true
      });
      return applySearchSelection(view, cfg.query, cfg.matchCase, idx);
    },
    replaceAll: (replacement) => {
      const view = viewRef.current;
      if (!view) return 0;
      const cfg = view.state.field(searchConfigField);
      if (!cfg.query) return 0;
      const matches = findMatches(view.state.doc.toString(), cfg.query, cfg.matchCase);
      if (!matches.length) return 0;
      view.dispatch({
        changes: matches.map((m) => ({ from: m.from, to: m.to, insert: replacement })),
        effects: setSearchConfigEffect.of({ query: cfg.query, matchCase: cfg.matchCase, activeIndex: -1 })
      });
      return matches.length;
    }
  }));

  // Mount CodeMirror once — clean & fast without slashMenu, floatingToolbar, or hoverPreview
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;
    const settings = useSettingsStore.getState();

    const extensions = [
      lineNumbersCompartmentRef.current.of(settings.showLineNumbers || settings.viewMode === 'syntax' ? lineNumbers() : []),
      historyCompartmentRef.current.of(history()),
      markdown(),
      smartFormatExtension(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      wrapCompartmentRef.current.of(settings.wordWrap ? EditorView.lineWrapping : []),
      collapseDataUrls,
      searchHighlightExtension,
      liveMarkdownCompartmentRef.current.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setContent(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const cursor = update.state.selection.main.head;
          setCursor(getCursorPosition(update.state.doc.toString(), cursor));
        }
      }),
      themeCompartmentRef.current.of(editorTheme(resolveIsDark(settings.theme), settings.viewMode))
    ];

    const state = EditorState.create({ doc: content, extensions });
    viewRef.current = new EditorView({ state, parent: containerRef.current });
    viewRef.current.focus();

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [setContent, setCursor]);

  // Sync content when switching tabs or loading from disk
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const tabChanged = lastTabIdRef.current !== tabId;
    lastTabIdRef.current = tabId;
    if (current === content && !tabChanged) return;
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
        annotations: Transaction.addToHistory.of(false)
      });
    }
    if (tabChanged || current !== content) {
      view.dispatch({ effects: historyCompartmentRef.current.reconfigure([]) });
      view.dispatch({ effects: historyCompartmentRef.current.reconfigure(history()) });
    }
  }, [content, tabId]);

  // Remember scroll per tab/file
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const key = documentPath ?? tabId;
    const saved = scrollPositions.get(key);
    if (saved !== undefined) {
      requestAnimationFrame(() => {
        if (viewRef.current === view) view.scrollDOM.scrollTop = saved;
      });
    } else {
      view.scrollDOM.scrollTop = 0;
    }
    const remember = () => scrollPositions.set(key, view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener('scroll', remember);
    return () => view.scrollDOM.removeEventListener('scroll', remember);
  }, [documentPath, tabId]);

  // Global Ctrl+Z / Ctrl+Y fallback when focus leaves editor
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const view = viewRef.current;
      if (!view || event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo(view);
        view.focus();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo(view);
        view.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Theme & viewMode typography sync
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const apply = (dark: boolean) =>
      view.dispatch({ effects: themeCompartmentRef.current.reconfigure(editorTheme(dark, viewMode)) });
    apply(resolveIsDark(appTheme));
    if (appTheme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [appTheme, viewMode]);

  // Line numbers & word wrap compartments
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        lineNumbersCompartmentRef.current.reconfigure(showLineNumbers || viewMode === 'syntax' ? lineNumbers() : []),
        wrapCompartmentRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : [])
      ]
    });
  }, [showLineNumbers, wordWrap, viewMode]);

  // Paste/drop image upload to local backend
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    return attachPasteDrop(root, () => viewRef.current, () => documentPath);
  }, [documentPath]);

  // Toggle liveMarkdown cleanly between Formatted <-> Syntax
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: liveMarkdownCompartmentRef.current.reconfigure(
        viewMode === 'formatted' ? liveMarkdown(documentPath) : []
      )
    });
  }, [documentPath, viewMode]);

  return (
    <section className={`pane editor-pane${viewMode === 'formatted' ? ' full-mode' : ''}`}>
      <div ref={containerRef} className="editor-host" />
    </section>
  );
});

EditorPane.displayName = 'EditorPane';
