import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  BrainCircuit,
  EyeOff,
  Mic,
  Moon,
  NotebookTabs,
  Search,
  Sun
} from 'lucide-react';
import { EditorPane } from './components/EditorPane';
import { FindReplaceBar } from './components/FindReplaceBar';
import type { FindBarMode } from './components/FindReplaceBar';
import { FormatToolbar } from './components/FormatToolbar';
import { HiddenItemsPanel } from './components/HiddenItemsPanel';
import { ModulePlaceholder } from './components/ModulePlaceholder';
import { NotesSidebar } from './components/NotesSidebar';
import { SearchModal } from './components/SearchModal';
import { StatusBar } from './components/StatusBar';
import { TabBar } from './components/TabBar';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useAppZoom } from './hooks/useAppZoom';
import { persistActiveAndSession, useSessionPersistence } from './hooks/useSessionPersistence';
import type { SearchHit } from './lib/api';
import { exportTextFile, openTextFile } from './lib/fileService';
import { inlineNoteImages } from './lib/imageAssets';
import { flushNoteWrites, noteGroupName, readNote, writeNoteQueued } from './lib/noteService';
import type { NoteMeta } from './lib/noteService';
import { useDocStore } from './store/docStore';
import { useNotesStore } from './store/notesStore';
import { useSettingsStore } from './store/settingsStore';
import type { AppSection, EditorApi, ThemeMode } from './types';

function themeLabel(theme: ThemeMode): string {
  if (theme === 'dark') return 'Dark';
  if (theme === 'light') return 'Light';
  return 'System';
}

function automaticNoteTitle(content: string): string | null {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, ''))
    .find(Boolean);
  if (!firstLine) return null;
  const cleanTitle = firstLine.replace(/[*_`]/g, '').trim();
  return cleanTitle ? Array.from(cleanTitle).slice(0, 36).join('') : null;
}

export default function App() {
  const editorRef = useRef<EditorApi | null>(null);
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState<AppSection>('notes');
  const [sidebarView, setSidebarView] = useState<'notes' | 'hidden'>('notes');
  const [findMode, setFindMode] = useState<FindBarMode>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const { activeTabId, content, file, notePath, projectSlug, closeTab, markSaved, openNoteTab, openScratchTab } =
    useDocStore();
  const { viewMode, theme, sidebarOpen, sidebarWidth, toggleViewMode, setTheme, toggleSidebar, setSidebarWidth } =
    useSettingsStore();

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2000);
  }, []);

  const showSidebarView = useCallback(
    (view: 'notes' | 'hidden') => {
      if (section !== 'notes') {
        setSection('notes');
        setSidebarView(view);
        if (!sidebarOpen) toggleSidebar();
        return;
      }
      if (sidebarOpen && sidebarView === view) {
        toggleSidebar();
        return;
      }
      setSidebarView(view);
      if (!sidebarOpen) toggleSidebar();
    },
    [section, sidebarOpen, sidebarView, toggleSidebar]
  );

  const changeZoom = useAppZoom(showNotice);
  useSessionPersistence();

  const openNote = useCallback(
    async (note: NoteMeta) => {
      try {
        await flushNoteWrites();
        const noteContent = await readNote(note.path);
        openNoteTab(
          { path: note.path, name: note.name, projectSlug: note.projectSlug || noteGroupName(note.path) || 'Inbox' },
          noteContent
        );
        useNotesStore.getState().selectProject(note.projectSlug || noteGroupName(note.path));
        setSection('notes');
        editorRef.current?.focus();
      } catch (error) {
        console.error('PlainMark: open note failed', error);
        showNotice('เปิดโน้ตไม่สำเร็จ');
      }
    },
    [openNoteTab, showNotice]
  );

  const createNote = useCallback(
    async (targetProjectSlug?: string) => {
      await flushNoteWrites();
      const note = await useNotesStore.getState().addNote(targetProjectSlug);
      if (note) {
        await openNote(note);
      } else {
        openScratchTab('Untitled', '');
      }
    },
    [openNote, openScratchTab]
  );

  const handleNew = useCallback(() => {
    const target = useNotesStore.getState().selectedProjectSlug ?? projectSlug ?? undefined;
    void createNote(target);
  }, [createNote, projectSlug]);

  const handleOpenExternal = useCallback(async () => {
    const loaded = await openTextFile();
    if (!loaded) return;
    openScratchTab(loaded.name, loaded.content);
    setSection('notes');
    showNotice(`เปิดไฟล์ ${loaded.name}`);
  }, [openScratchTab, showNotice]);

  const handleSave = useCallback(async () => {
    const state = useDocStore.getState();
    if (state.notePath) {
      const text =
        state.lineEnding === 'CRLF'
          ? state.content.replace(/\r?\n/g, '\r\n')
          : state.content.replace(/\r\n/g, '\n');
      await writeNoteQueued(state.notePath, text);
      markSaved(state.content);
      showNotice('บันทึกแล้ว');
      return;
    }
    // Draft tab without a notePath yet -> save into selected project as a real note!
    const title = automaticNoteTitle(state.content) || 'Untitled';
    const created = await useNotesStore.getState().addNote(undefined, title);
    if (!created) {
      showNotice('บันทึกไม่สำเร็จ (backend ออฟไลน์)');
      return;
    }
    await writeNoteQueued(created.path, state.content);
    useDocStore.getState().setNotePath(created.path);
    useDocStore.getState().syncNoteMeta(created.path, created);
    markSaved(state.content);
    showNotice(`บันทึกเข้าโปรเจค ${created.projectSlug} แล้ว`);
  }, [markSaved, showNotice]);

  const handleSaveAll = useCallback(async () => {
    await persistActiveAndSession();
    showNotice('บันทึกทุกแท็บแล้ว');
  }, [showNotice]);

  const handleExport = useCallback(
    async (extension: 'md' | 'txt') => {
      const exportContent =
        extension === 'md' ? await inlineNoteImages(content, notePath) : content;
      exportTextFile(exportContent, file.name, extension);
      showNotice(`ส่งออก .${extension} แล้ว`);
    },
    [content, file.name, notePath, showNotice]
  );

  const handleSelectSearchHit = useCallback(
    (hit: SearchHit) => {
      void openNote({
        name: hit.title,
        path: hit.path,
        projectSlug: hit.projectSlug,
        createdAt: hit.updatedAt,
        updatedAt: hit.updatedAt
      });
    },
    [openNote]
  );

  const cycleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(nextTheme);
  }, [setTheme, theme]);

  const shortcutHandlers = useMemo(
    () => ({
      onNew: handleNew,
      onOpen: () => void handleOpenExternal(),
      onSave: () => void handleSave(),
      onSaveAll: () => void handleSaveAll(),
      onCloseTab: () => closeTab(useDocStore.getState().activeTabId),
      onFind: (withReplace: boolean) => setFindMode(withReplace ? 'replace' : 'find'),
      onGoToLine: () => setFindMode('goto'),
      onGlobalSearch: () => setSearchOpen(true),
      onToggleViewMode: toggleViewMode,
      changeZoom
    }),
    [changeZoom, closeTab, handleNew, handleOpenExternal, handleSave, handleSaveAll, toggleViewMode]
  );

  useAppShortcuts(shortcutHandlers);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Auto-rename brand-new "new note" from its first line safely (captured notePath + content)
  useEffect(() => {
    if (!notePath || !/^new note(?: \(\d+\))?\.md$/i.test(file.name)) return;
    const title = automaticNoteTitle(content);
    if (!title) return;
    const capturedPath = notePath;
    const timer = window.setTimeout(() => {
      if (useDocStore.getState().notePath !== capturedPath) return;
      void useNotesStore
        .getState()
        .renameNoteAt(capturedPath, title)
        .then((renamed) => {
          if (!renamed) return;
          useDocStore.getState().syncNoteMeta(capturedPath, renamed);
        });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [content, file.name, notePath]);

  return (
    <div className="app-shell">
      <TabBar
        onNewTab={handleNew}
        onOpenExternal={() => void handleOpenExternal()}
        onSaveAll={() => void handleSaveAll()}
        onExport={(ext) => void handleExport(ext)}
      />

      {section === 'notes' && (
        <FormatToolbar
          editorRef={editorRef}
          onOpenFind={() => setFindMode('find')}
          onOpenGlobalSearch={() => setSearchOpen(true)}
        />
      )}

      <main
        className={`workspace ${section === 'notes' && sidebarOpen ? 'with-notes' : ''}`}
        style={{ '--notes-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <aside className="activity-bar" aria-label="Workspace modules">
          <button
            type="button"
            className={`activity-button ${section === 'notes' && sidebarOpen && sidebarView === 'notes' ? 'active' : ''}`}
            title="Notes & Projects (แผน 1)"
            aria-label="โปรเจคและโน้ต"
            onClick={() => showSidebarView('notes')}
          >
            <NotebookTabs size={19} />
          </button>
          <button
            type="button"
            className={`activity-button ${section === 'meetings' ? 'active' : ''}`}
            title="Meetings — MP4 & Audio (แผน 2)"
            aria-label="การประชุม"
            onClick={() => setSection('meetings')}
          >
            <Mic size={19} />
          </button>
          <button
            type="button"
            className={`activity-button ${section === 'knowledge' ? 'active' : ''}`}
            title="Knowledge Hub — Links & Docs (แผน 3)"
            aria-label="คลังความรู้"
            onClick={() => setSection('knowledge')}
          >
            <BookMarked size={19} />
          </button>
          <button
            type="button"
            className={`activity-button ${section === 'insights' ? 'active' : ''}`}
            title="Personal AI Insights (แผนพิเศษ)"
            aria-label="ภาพรวมและตัวตน"
            onClick={() => setSection('insights')}
          >
            <BrainCircuit size={19} />
          </button>

          <div className="activity-spacer" />

          <button
            type="button"
            className="activity-button"
            title="ค้นหาข้ามทุกโปรเจค (Ctrl+P)"
            aria-label="ค้นหาโน้ต"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            className={`activity-button ${section === 'notes' && sidebarOpen && sidebarView === 'hidden' ? 'active' : ''}`}
            title="รายการที่ซ่อน"
            aria-label="รายการที่ซ่อน"
            onClick={() => showSidebarView('hidden')}
          >
            <EyeOff size={18} />
          </button>
          <button
            type="button"
            className="activity-button"
            title={`ธีม: ${themeLabel(theme)}`}
            aria-label="สลับธีม"
            onClick={cycleTheme}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </aside>

        {section === 'notes' ? (
          <>
            {sidebarOpen &&
              (sidebarView === 'hidden' ? (
                <HiddenItemsPanel onOpenNote={(note) => void openNote(note)} />
              ) : (
                <NotesSidebar
                  onOpenNote={(note) => void openNote(note)}
                  onCreateNote={(slug) => void createNote(slug)}
                  onNotice={showNotice}
                  width={sidebarWidth}
                  onResize={setSidebarWidth}
                />
              ))}

            <div className="editor-stage">
              <FindReplaceBar
                mode={findMode}
                editorRef={editorRef}
                onClose={() => setFindMode(null)}
                onModeChange={setFindMode}
                onNotice={showNotice}
              />
              <EditorPane
                ref={editorRef}
                tabId={activeTabId}
                documentPath={notePath}
                viewMode={viewMode}
              />
            </div>
          </>
        ) : (
          <ModulePlaceholder section={section} onBackToNotes={() => setSection('notes')} />
        )}
      </main>

      <StatusBar onClickGoToLine={() => setFindMode('goto')} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelectHit={handleSelectSearchHit} />
      <div className={`toast ${notice ? 'show' : ''}`}>{notice}</div>
    </div>
  );
}
