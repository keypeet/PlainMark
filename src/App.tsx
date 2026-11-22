import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightCircle, Copy, Trash2 } from 'lucide-react';
import { AssistantDrawer } from './components/AssistantDrawer';
import { ClosedHistoryModal } from './components/ClosedHistoryModal';
import { CloseReasonModal, type CloseReasonTarget } from './components/CloseReasonModal';
import { EditorPane } from './components/EditorPane';
import { FindReplaceBar, type FindBarMode } from './components/FindReplaceBar';
import { FormatToolbar } from './components/FormatToolbar';
import { InsightsView } from './components/InsightsView';
import { KnowledgeView } from './components/KnowledgeView';
import { MeetingsView } from './components/MeetingsView';
import { NotesListCard } from './components/NotesListCard';
import { ProjectRail } from './components/ProjectRail';
import { SearchModal } from './components/SearchModal';
import { SettingsView } from './components/SettingsView';
import { StatusBar } from './components/StatusBar';
import { TabBar } from './components/TabBar';
import { TopNavBar } from './components/TopNavBar';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useAppZoom } from './hooks/useAppZoom';
import { persistActiveAndSession, useSessionPersistence } from './hooks/useSessionPersistence';
import {
  apiGetBoard,
  apiReadScratch,
  apiSaveBoard,
  apiUpdateScratch,
  type ScratchMeta,
  type SearchHit
} from './lib/api';
import { exportTextFile, openTextFile } from './lib/fileService';
import { inlineNoteImages } from './lib/imageAssets';
import { flushNoteWrites, noteGroupName, readNote, writeNoteQueued } from './lib/noteService';
import type { NoteMeta } from './lib/noteService';
import { useDocStore } from './store/docStore';
import { useNotesStore } from './store/notesStore';
import { useSettingsStore } from './store/settingsStore';
import type { AppSection, EditorApi, EditorWidthPreset } from './types';

function automaticNoteTitle(content: string): string | null {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, ''))
    .find(Boolean);
  if (!firstLine) return null;
  const cleanTitle = firstLine.replace(/[*_`]/g, '').trim();
  return cleanTitle ? Array.from(cleanTitle).slice(0, 36).join('') : null;
}

function editorWidthValue(preset: EditorWidthPreset): string {
  if (preset === 'narrow') return '760px';
  if (preset === 'full') return '100%';
  return '1040px';
}

export default function App() {
  const editorRef = useRef<EditorApi | null>(null);
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState<AppSection>('notes');
  const [findMode, setFindMode] = useState<FindBarMode>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<CloseReasonTarget | null>(null);
  const [closedHistoryOpen, setClosedHistoryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);

  const {
    activeTabId,
    content,
    file,
    notePath,
    scratchId,
    closeTab,
    closeNotePath,
    markSaved,
    openNoteTab,
    openScratchTab,
    openPersistedScratchTab
  } = useDocStore();

  const {
    viewMode,
    theme,
    accentColor,
    fontFamily,
    fontSize,
    editorWidth,
    toggleViewMode,
    loadBackendSettings
  } = useSettingsStore();

  const activeScope = useNotesStore((s) => s.activeScope);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }, []);

  const changeZoom = useAppZoom(showNotice);
  useSessionPersistence();

  useEffect(() => {
    void useNotesStore.getState().refresh();
    void loadBackendSettings();
  }, [loadBackendSettings]);

  // Apply V5 live appearance tokens
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accentColor;
    root.dataset.font = fontFamily;
    root.style.setProperty('--fs-base', `${fontSize}px`);
    root.style.setProperty('--editor-max-w', editorWidthValue(editorWidth));
  }, [theme, accentColor, fontFamily, fontSize, editorWidth]);

  // Autosave persisted scratchpad edits to scratch/
  useEffect(() => {
    if (!scratchId) return;
    const capturedId = scratchId;
    const timer = window.setTimeout(() => {
      if (useDocStore.getState().scratchId !== capturedId) return;
      void apiUpdateScratch(capturedId, content).then(() => {
        useDocStore.getState().markSaved(content);
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [content, scratchId]);

  const openNote = useCallback(
    async (note: NoteMeta) => {
      try {
        await flushNoteWrites();
        const noteContent = await readNote(note.path);
        const slug = note.projectSlug || noteGroupName(note.path) || 'Inbox';
        openNoteTab({ path: note.path, name: note.name, projectSlug: slug }, noteContent);
        setSection('notes');
        editorRef.current?.focus();
      } catch (error) {
        console.error('PlainMark: open note failed', error);
        showNotice('เปิดโน้ตไม่สำเร็จ');
      }
    },
    [openNoteTab, showNotice]
  );

  const openScratch = useCallback(
    async (sc: ScratchMeta) => {
      try {
        const doc = await apiReadScratch(sc.id);
        openPersistedScratchTab({ id: doc.id, title: doc.title, content: doc.content });
        setSection('notes');
        editorRef.current?.focus();
      } catch (error) {
        console.error('PlainMark: open scratch failed', error);
        showNotice('เปิดกระดาษร่างไม่สำเร็จ');
      }
    },
    [openPersistedScratchTab, showNotice]
  );

  const createNoteInActiveScope = useCallback(async () => {
    await flushNoteWrites();
    const note = await useNotesStore.getState().addNoteInScope(activeScope);
    if (note) {
      await openNote(note);
    } else {
      openScratchTab('Untitled', '');
    }
  }, [activeScope, openNote, openScratchTab]);

  const createPersistedScratch = useCallback(async () => {
    const created = await useNotesStore.getState().addScratch();
    if (created) {
      openPersistedScratchTab({
        id: created.id,
        title: created.title,
        content: created.content
      });
      setSection('notes');
      editorRef.current?.focus();
      showNotice('สร้างกระดาษร่างแล้ว');
    } else {
      openScratchTab('Untitled', '');
    }
  }, [openPersistedScratchTab, openScratchTab, showNotice]);

  const handleOpenExternal = useCallback(async () => {
    const loaded = await openTextFile();
    if (!loaded) return;
    openScratchTab(loaded.name, loaded.content);
    setSection('notes');
    showNotice(`เปิดไฟล์ ${loaded.name}`);
  }, [openScratchTab, showNotice]);

  const handleSave = useCallback(async () => {
    const state = useDocStore.getState();
    if (state.scratchId) {
      await apiUpdateScratch(state.scratchId, state.content);
      markSaved(state.content);
      showNotice('บันทึกกระดาษร่างแล้ว');
      return;
    }
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
    const title = automaticNoteTitle(state.content) || 'Untitled';
    const created = await useNotesStore.getState().addNoteInScope(activeScope, title);
    if (!created) {
      showNotice('บันทึกไม่สำเร็จ (backend ออฟไลน์)');
      return;
    }
    await writeNoteQueued(created.path, state.content);
    useDocStore.getState().setNotePath(created.path);
    useDocStore.getState().syncNoteMeta(created.path, created);
    markSaved(state.content);
    showNotice('บันทึกโน้ตแล้ว');
  }, [activeScope, markSaved, showNotice]);

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

  const shortcutHandlers = useMemo(
    () => ({
      onNew: () => void createNoteInActiveScope(),
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
    [
      changeZoom,
      closeTab,
      createNoteInActiveScope,
      handleOpenExternal,
      handleSave,
      handleSaveAll,
      toggleViewMode
    ]
  );

  useAppShortcuts(shortcutHandlers);

  // Also bind Ctrl+K for Quick Search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Auto-rename brand-new "new note" from its first line safely
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

  const handleConfirmClose = async (payload: {
    reason: string;
    assignee: string;
    note: string;
  }) => {
    if (!closeTarget) return;
    const store = useNotesStore.getState();
    let snapshot = { ...closeTarget.snapshot };
    if (closeTarget.itemType === 'note') {
      const currentContent =
        notePath === closeTarget.idOrPath
          ? content
          : await readNote(closeTarget.idOrPath).catch(() => '');
      snapshot = { ...snapshot, content: currentContent };
      await store.recordClosedItem({
        itemType: 'note',
        scope: closeTarget.scope,
        title: closeTarget.title,
        reason: payload.reason,
        assignee: payload.assignee,
        note: payload.note,
        snapshot
      });
      await store.removeNote(closeTarget.idOrPath);
      closeNotePath(closeTarget.idOrPath);
    } else if (closeTarget.itemType === 'scratch') {
      const doc = await apiReadScratch(closeTarget.idOrPath).catch(() => null);
      snapshot = { ...snapshot, content: doc?.content ?? '' };
      await store.recordClosedItem({
        itemType: 'scratch',
        scope: 'general',
        title: closeTarget.title,
        reason: payload.reason,
        assignee: payload.assignee,
        note: payload.note,
        snapshot
      });
      await store.removeScratch(closeTarget.idOrPath);
      if (scratchId === closeTarget.idOrPath) {
        closeTab(activeTabId);
      }
    } else if (closeTarget.itemType === 'card') {
      await store.recordClosedItem({
        itemType: 'card',
        scope: closeTarget.scope,
        title: closeTarget.title,
        reason: payload.reason,
        assignee: payload.assignee,
        note: payload.note,
        snapshot
      });
      const currentBoard = await apiGetBoard(closeTarget.scope);
      await apiSaveBoard(closeTarget.scope, {
        ...currentBoard,
        cards: currentBoard.cards.filter((c) => c.id !== closeTarget.idOrPath)
      });
      setBoardRefreshKey((k) => k + 1);
    }
    setCloseTarget(null);
    showNotice('บันทึกเหตุผลและปิดรายการแล้ว');
  };

  return (
    <div className="v5-shell">
      <ProjectRail
        section={section}
        onSelectSection={setSection}
        onOpenSearch={() => setSearchOpen(true)}
        onNotice={showNotice}
      />

      <div className="v5-main">
        <TopNavBar
          section={section}
          onSelectSection={setSection}
          onNewNote={() => void createNoteInActiveScope()}
          onNewScratch={() => void createPersistedScratch()}
          onOpenClosedHistory={() => setClosedHistoryOpen(true)}
          onOpenAssistant={() => setAssistantOpen((v) => !v)}
        />

        {section === 'notes' ? (
          <div className="notes-workspace-shell">
            <NotesListCard
              onOpenNote={(note) => void openNote(note)}
              onOpenScratch={(sc) => void openScratch(sc)}
              onRequestClose={setCloseTarget}
              onNotice={showNotice}
            />

            <div className={`notes-editor-card ${scratchId ? 'is-scratch' : ''}`}>
              <TabBar
                onNewTab={() => void createNoteInActiveScope()}
                onOpenExternal={() => void handleOpenExternal()}
                onSaveAll={() => void handleSaveAll()}
                onExport={(ext) => void handleExport(ext)}
              />

              <FormatToolbar
                editorRef={editorRef}
                onOpenFind={() => setFindMode('find')}
                onOpenGlobalSearch={() => setSearchOpen(true)}
              />

              {scratchId && (
                <div className="scratch-banner">
                  <span>กระดาษร่างชั่วคราว (ไม่รวมใน AI Insights และ source_hash)</span>
                  <div className="scratch-banner-actions">
                    <button
                      type="button"
                      className="v5-btn"
                      onClick={() => {
                        void navigator.clipboard?.writeText(content);
                        showNotice('คัดลอก Prompt ทั้งหมดแล้ว');
                      }}
                    >
                      <Copy size={13} /> คัดลอก Prompt
                    </button>
                    <button
                      type="button"
                      className="v5-btn primary"
                      onClick={() => {
                        const targetScope = activeScope === 'all' ? 'general' : activeScope;
                        void useNotesStore
                          .getState()
                          .promoteScratch(scratchId, targetScope, file.name.replace(/\.md$/i, ''))
                          .then((note) => {
                            if (note) {
                              closeTab(activeTabId);
                              void openNote(note);
                              showNotice('เก็บเป็นโน้ตจริงแล้ว');
                            }
                          });
                      }}
                    >
                      <ArrowRightCircle size={13} /> เก็บเป็นโน้ต
                    </button>
                    <button
                      type="button"
                      className="v5-btn danger"
                      onClick={() =>
                        setCloseTarget({
                          itemType: 'scratch',
                          scope: 'general',
                          title: file.name.replace(/\.md$/i, ''),
                          idOrPath: scratchId,
                          snapshot: { id: scratchId, title: file.name.replace(/\.md$/i, '') }
                        })
                      }
                    >
                      <Trash2 size={13} /> ลบทิ้ง
                    </button>
                  </div>
                </div>
              )}

              <div className="editor-main-area">
                <div className="editor-pane-wrap">
                  <div className="editor-pane-inner">
                    <EditorPane
                      ref={editorRef}
                      tabId={activeTabId}
                      documentPath={notePath}
                      viewMode={viewMode}
                    />
                  </div>
                </div>

                <FindReplaceBar
                  mode={findMode}
                  editorRef={editorRef}
                  onClose={() => setFindMode(null)}
                  onModeChange={setFindMode}
                  onNotice={showNotice}
                />
              </div>

              <StatusBar onClickGoToLine={() => setFindMode('goto')} />
            </div>
          </div>
        ) : section === 'settings' ? (
          <SettingsView onNotice={showNotice} />
        ) : section === 'insights' ? (
          <InsightsView
            boardRefreshKey={boardRefreshKey}
            onSelectSection={setSection}
            onOpenNote={(note) => void openNote(note)}
            onRequestClose={setCloseTarget}
            onNotice={showNotice}
          />
        ) : section === 'meetings' ? (
          <MeetingsView onNotice={showNotice} />
        ) : (
          <KnowledgeView onNotice={showNotice} />
        )}
      </div>

      <AssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onOpenNoteByPath={(path) => {
          const st = useNotesStore.getState();
          const allNotes = [
            ...st.generalNotes,
            ...st.projects.flatMap((p) => p.notes || [])
          ];
          const found = allNotes.find((n) => n.path === path);
          if (found) {
            void openNote(found);
          } else {
            void openNote({
              name: path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || 'Note',
              path,
              projectSlug: 'Inbox',
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
          }
        }}
      />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectHit={handleSelectSearchHit}
      />
      <CloseReasonModal
        target={closeTarget}
        onCancel={() => setCloseTarget(null)}
        onConfirm={handleConfirmClose}
      />
      <ClosedHistoryModal
        open={closedHistoryOpen}
        onClose={() => {
          setClosedHistoryOpen(false);
          setBoardRefreshKey((k) => k + 1);
        }}
        onNotice={showNotice}
      />
      <div className={`toast ${notice ? 'show' : ''}`}>{notice}</div>
    </div>
  );
}
