import { create } from 'zustand';
import type { CursorPosition, FileRecord, LineEnding, TabDocument } from '../types';

export interface HydrateSession {
  content: string;
  filePath: string | null;
  fileName: string;
  notePath: string | null;
  dirty: boolean;
}

export interface HydrateTabsPayload {
  tabs: Array<{
    id: string;
    title: string;
    notePath: string | null;
    projectSlug: string | null;
    content: string;
    dirty: boolean;
    lineEnding?: LineEnding;
  }>;
  activeTabId: string | null;
}

const dirtySentinel = '\u0000';

let tabSeq = 1;
function nextTabId(): string {
  return `tab-${Date.now()}-${tabSeq++}`;
}

function detectLineEnding(text: string): LineEnding {
  return text.includes('\r\n') ? 'CRLF' : 'LF';
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function makeScratchTab(title = 'Untitled', content = ''): TabDocument {
  const normalized = normalizeNewlines(content);
  return {
    id: nextTabId(),
    title,
    notePath: null,
    projectSlug: null,
    content: normalized,
    lastSavedContent: normalized,
    dirty: false,
    lineEnding: detectLineEnding(content),
    cursor: { line: 1, column: 1 }
  };
}

function activeFields(tabs: TabDocument[], activeTabId: string) {
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  return {
    tabs,
    activeTabId: active.id,
    content: active.content,
    file: { path: active.notePath, name: active.title.endsWith('.md') ? active.title : `${active.title}.md` } as FileRecord,
    notePath: active.notePath,
    projectSlug: active.projectSlug,
    dirty: active.dirty,
    cursor: active.cursor,
    lineEnding: active.lineEnding,
    lastSavedContent: active.lastSavedContent
  };
}

interface DocState {
  tabs: TabDocument[];
  activeTabId: string;
  // Mirrored active-tab fields for fast selector access
  content: string;
  file: FileRecord;
  notePath: string | null;
  projectSlug: string | null;
  dirty: boolean;
  cursor: CursorPosition;
  lineEnding: LineEnding;
  lastSavedContent: string;

  setContent: (content: string, markDirty?: boolean) => void;
  setCursor: (cursor: CursorPosition) => void;
  setLineEnding: (lineEnding: LineEnding) => void;
  setFile: (file: FileRecord) => void;
  setNotePath: (notePath: string | null) => void;
  markSaved: (content?: string) => void;
  markTabSaved: (tabId: string, content?: string) => void;
  newDocument: () => void;

  openNoteTab: (note: { path: string; name: string; projectSlug: string }, content: string) => void;
  openScratchTab: (title?: string, content?: string) => void;
  setActiveTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  syncNoteMeta: (oldPath: string, next: { path: string; name: string; projectSlug: string }) => void;
  closeNotePath: (notePath: string) => void;
  hydrate: (session: HydrateSession) => void;
  hydrateTabs: (payload: HydrateTabsPayload) => void;
}

const initialTab = makeScratchTab('Untitled', '');

export const useDocStore = create<DocState>((set, get) => ({
  ...activeFields([initialTab], initialTab.id),

  setContent: (content, markDirty = true) => {
    const { tabs, activeTabId } = get();
    const nextTabs = tabs.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      const dirty = markDirty ? content !== tab.lastSavedContent : tab.dirty;
      return { ...tab, content, dirty };
    });
    set(activeFields(nextTabs, activeTabId));
  },

  setCursor: (cursor) => {
    const { tabs, activeTabId } = get();
    const nextTabs = tabs.map((tab) => (tab.id === activeTabId ? { ...tab, cursor } : tab));
    set({ tabs: nextTabs, cursor });
  },

  setLineEnding: (lineEnding) => {
    const { tabs, activeTabId } = get();
    const nextTabs = tabs.map((tab) => (tab.id === activeTabId ? { ...tab, lineEnding, dirty: true } : tab));
    set(activeFields(nextTabs, activeTabId));
  },

  setFile: (file) => {
    const { tabs, activeTabId } = get();
    const title = file.name.replace(/\.md$/i, '') || 'Untitled';
    const nextTabs = tabs.map((tab) => (tab.id === activeTabId ? { ...tab, title, notePath: tab.notePath } : tab));
    set({ ...activeFields(nextTabs, activeTabId), file });
  },

  setNotePath: (notePath) => {
    const { tabs, activeTabId } = get();
    const nextTabs = tabs.map((tab) => (tab.id === activeTabId ? { ...tab, notePath } : tab));
    set(activeFields(nextTabs, activeTabId));
  },

  markSaved: (content) => {
    get().markTabSaved(get().activeTabId, content);
  },

  markTabSaved: (tabId, content) => {
    const { tabs, activeTabId } = get();
    const nextTabs = tabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      const saved = content ?? tab.content;
      return { ...tab, dirty: false, lastSavedContent: saved };
    });
    set(activeFields(nextTabs, activeTabId));
  },

  newDocument: () => {
    const fresh = makeScratchTab('Untitled', '');
    set(activeFields([fresh], fresh.id));
  },

  openNoteTab: (note, rawContent) => {
    const { tabs, activeTabId } = get();
    const content = normalizeNewlines(rawContent);
    const lineEnding = detectLineEnding(rawContent);
    const existing = tabs.find((tab) => tab.notePath === note.path);
    if (existing) {
      const nextTabs = tabs.map((tab) =>
        tab.id === existing.id && !tab.dirty
          ? { ...tab, title: note.name, projectSlug: note.projectSlug, content, lastSavedContent: content, lineEnding }
          : tab
      );
      set(activeFields(nextTabs, existing.id));
      return;
    }

    const active = tabs.find((t) => t.id === activeTabId);
    const canReuseActive = active && !active.notePath && !active.dirty && active.content.length === 0;
    const nextTab: TabDocument = {
      id: canReuseActive ? active.id : nextTabId(),
      title: note.name,
      notePath: note.path,
      projectSlug: note.projectSlug,
      content,
      lastSavedContent: content,
      dirty: false,
      lineEnding,
      cursor: { line: 1, column: 1 }
    };
    const nextTabs = canReuseActive
      ? tabs.map((tab) => (tab.id === active.id ? nextTab : tab))
      : [...tabs, nextTab];
    set(activeFields(nextTabs, nextTab.id));
  },

  openScratchTab: (title = 'Untitled', content = '') => {
    const { tabs } = get();
    const fresh = makeScratchTab(title.replace(/\.md$/i, '') || 'Untitled', content);
    set(activeFields([...tabs, fresh], fresh.id));
  },

  setActiveTab: (tabId) => {
    const { tabs } = get();
    if (!tabs.some((tab) => tab.id === tabId)) return;
    set(activeFields(tabs, tabId));
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((tab) => tab.id === tabId);
    if (idx === -1) return;
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    if (remaining.length === 0) {
      const fresh = makeScratchTab('Untitled', '');
      set(activeFields([fresh], fresh.id));
      return;
    }
    const nextActiveId =
      activeTabId === tabId ? remaining[Math.min(idx, remaining.length - 1)].id : activeTabId;
    set(activeFields(remaining, nextActiveId));
  },

  closeOtherTabs: (tabId) => {
    const { tabs } = get();
    const target = tabs.find((t) => t.id === tabId);
    if (!target) return;
    set(activeFields([target], target.id));
  },

  closeTabsToRight: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const kept = tabs.slice(0, idx + 1);
    const nextActive = kept.some((t) => t.id === activeTabId) ? activeTabId : kept[kept.length - 1].id;
    set(activeFields(kept, nextActive));
  },

  syncNoteMeta: (oldPath, next) => {
    const { tabs, activeTabId } = get();
    let changed = false;
    const nextTabs = tabs.map((tab) => {
      if (tab.notePath !== oldPath) return tab;
      changed = true;
      return { ...tab, notePath: next.path, title: next.name, projectSlug: next.projectSlug };
    });
    if (changed) set(activeFields(nextTabs, activeTabId));
  },

  closeNotePath: (notePath) => {
    const { tabs, activeTabId } = get();
    const remaining = tabs.filter((tab) => tab.notePath !== notePath);
    if (remaining.length === tabs.length) return;
    if (remaining.length === 0) {
      const fresh = makeScratchTab('Untitled', '');
      set(activeFields([fresh], fresh.id));
      return;
    }
    const nextActive = remaining.some((t) => t.id === activeTabId) ? activeTabId : remaining[0].id;
    set(activeFields(remaining, nextActive));
  },

  hydrate: (session) => {
    const title = session.fileName.replace(/\.md$/i, '') || 'Untitled';
    const tab: TabDocument = {
      id: nextTabId(),
      title,
      notePath: session.notePath,
      projectSlug: null,
      content: session.content,
      lastSavedContent: session.dirty ? session.content + dirtySentinel : session.content,
      dirty: session.dirty,
      lineEnding: detectLineEnding(session.content),
      cursor: { line: 1, column: 1 }
    };
    set({
      ...activeFields([tab], tab.id),
      file: { path: session.filePath, name: session.fileName }
    });
  },

  hydrateTabs: (payload) => {
    if (!payload.tabs.length) return;
    const hydrated: TabDocument[] = payload.tabs.map((item) => ({
      id: item.id || nextTabId(),
      title: item.title || 'Untitled',
      notePath: item.notePath,
      projectSlug: item.projectSlug,
      content: item.content,
      lastSavedContent: item.dirty ? item.content + dirtySentinel : item.content,
      dirty: item.dirty,
      lineEnding: item.lineEnding ?? detectLineEnding(item.content),
      cursor: { line: 1, column: 1 }
    }));
    const activeId =
      payload.activeTabId && hydrated.some((t) => t.id === payload.activeTabId)
        ? payload.activeTabId
        : hydrated[0].id;
    set(activeFields(hydrated, activeId));
  }
}));
