import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  Moon,
  NotebookTabs,
  PanelLeft,
  PanelRight,
  Save,
  ScrollText,
  Sun
} from 'lucide-react';
import { EditorPane } from './components/EditorPane';
import { NotesSidebar } from './components/NotesSidebar';
import { PreviewPane } from './components/PreviewPane';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useAppZoom } from './hooks/useAppZoom';
import { useRenderedMarkdown } from './hooks/useRenderedMarkdown';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { flushNoteWrites, noteGroupName, notesSupported, readNote, writeNoteQueued } from './lib/noteService';
import type { NoteMeta } from './lib/noteService';
import { exportTextFile, openTextFile, saveTextFile } from './lib/fileService';
import { useDocStore } from './store/docStore';
import { useNotesStore } from './store/notesStore';
import { useSettingsStore } from './store/settingsStore';
import type { EditorApi, LayoutMode, ThemeMode } from './types';

function themeLabel(theme: ThemeMode): string {
  if (theme === 'dark') return 'Dark';
  if (theme === 'light') return 'Light';
  return 'System';
}

export default function App() {
  const editorRef = useRef<EditorApi | null>(null);
  const [notice, setNotice] = useState('');
  const { content, file, notePath, dirty, setContent, setFile, setNotePath, markSaved, newDocument } = useDocStore();
  const { layout, theme, sidebarOpen, setLayout, setTheme, toggleSidebar, addRecentFile } = useSettingsStore();
  const html = useRenderedMarkdown(content);

  const visible = useMemo(
    () => ({
      editor: layout === 'split' || layout === 'editor' || layout === 'full',
      preview: layout === 'split' || layout === 'preview'
    }),
    [layout]
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 1800);
  }, []);

  const changeZoom = useAppZoom(showNotice);
  useSessionPersistence();

  const openNote = useCallback(
    async (note: NoteMeta) => {
      try {
        await flushNoteWrites();
        const noteContent = await readNote(note.path);
        setContent(noteContent, false);
        setFile({ path: note.path, name: `${note.name}.md` });
        setNotePath(note.path);
        markSaved(noteContent);
        // การเลือกกลุ่มตามโน้ตที่เปิด — ปุ่ม New จะได้สร้างเข้ากลุ่มนี้
        useNotesStore.getState().selectGroup(noteGroupName(note.path));
        editorRef.current?.focus();
      } catch (error) {
        console.error('PlainMark: open note failed', error);
        showNotice('เปิดโน้ตไม่สำเร็จ');
      }
    },
    [markSaved, setContent, setFile, setNotePath, showNotice]
  );

  const createNote = useCallback(
    async (groupName?: string) => {
      await flushNoteWrites();
      const note = await useNotesStore.getState().addNote(groupName);
      if (note) await openNote(note);
    },
    [openNote]
  );

  const handleNew = useCallback(() => {
    // งานในโน้ตถูกบันทึกออโต้อยู่แล้ว — เตือนเฉพาะไฟล์ภายนอกที่ยังไม่ save
    if (!notePath && dirty && !window.confirm('มีงานที่ยังไม่บันทึก ต้องการสร้างไฟล์ใหม่หรือไม่?')) return;
    // สร้างเป็นโน้ตในกลุ่มที่เลือกอยู่ (คลิกหัวกลุ่ม/เปิดโน้ต) → กลุ่มของโน้ตที่เปิด → กลุ่มวันนี้
    if (notesSupported) {
      const { selectedGroup } = useNotesStore.getState();
      void createNote(selectedGroup ?? ((notePath && noteGroupName(notePath)) || undefined));
      return;
    }
    newDocument();
    editorRef.current?.focus();
  }, [createNote, dirty, newDocument, notePath]);

  const handleOpen = useCallback(async () => {
    if (!notePath && dirty && !window.confirm('มีงานที่ยังไม่บันทึก ต้องการเปิดไฟล์อื่นหรือไม่?')) return;
    const loaded = await openTextFile();
    if (!loaded) return;
    setContent(loaded.content, false);
    setFile({ path: loaded.path, name: loaded.name });
    setNotePath(null);
    markSaved(loaded.content);
    if (loaded.path) addRecentFile(loaded.path);
    showNotice(`Opened ${loaded.name}`);
  }, [addRecentFile, dirty, markSaved, notePath, setContent, setFile, setNotePath, showNotice]);

  const handleSave = useCallback(async () => {
    if (notePath) {
      // โน้ตบันทึกออโต้อยู่แล้ว — Ctrl+S คือ flush ทันที
      await writeNoteQueued(notePath, content);
      markSaved(content);
      showNotice('บันทึกแล้ว');
      return;
    }
    const saved = await saveTextFile(content, file.path);
    if (!saved) return;
    setFile({ path: saved.path, name: saved.name });
    markSaved(content);
    if (saved.path) addRecentFile(saved.path);
    showNotice(`Saved ${saved.name}`);
  }, [addRecentFile, content, file.path, markSaved, notePath, setFile, showNotice]);

  const handleExport = useCallback(
    async (extension: 'md' | 'txt') => {
      await exportTextFile(content, extension);
      showNotice(`Exported .${extension}`);
    },
    [content, showNotice]
  );

  const cycleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(nextTheme);
  }, [setTheme, theme]);

  useAppShortcuts({ onNew: handleNew, onOpen: handleOpen, onSave: handleSave, changeZoom });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app-shell">
      <header className="menubar">
        <div className="brand-mark" aria-label="PlainMark">
          <span className="brand-logo">P</span>
          <span>PlainMark</span>
        </div>

        <button className="menu-command" onClick={handleNew}>
          <FilePlus2 size={16} /> New
        </button>
        <button className="menu-command" onClick={() => void handleOpen()}>
          <FolderOpen size={16} /> Open
        </button>
        <button className="menu-command primary" onClick={() => void handleSave()}>
          <Save size={16} /> Save
        </button>
        <button className="menu-command" onClick={() => void handleExport('md')}>
          <Download size={16} /> .md
        </button>
        <button className="menu-command" onClick={() => void handleExport('txt')}>
          <Download size={16} /> .txt
        </button>

        <div className="spacer" />

        <div className="segmented" aria-label="Layout">
          {(['split', 'editor', 'preview', 'full'] as LayoutMode[]).map((mode) => (
            <button key={mode} className={layout === mode ? 'active' : ''} onClick={() => setLayout(mode)}>
              {mode === 'split' && <PanelLeft size={15} />}
              {mode === 'editor' && <PanelRight size={15} />}
              {mode === 'preview' && <Eye size={15} />}
              {mode === 'full' && <ScrollText size={15} />}
              {mode}
            </button>
          ))}
        </div>

        <button
          className={`icon-command ${sidebarOpen ? 'active' : ''}`}
          title="โน้ตของฉัน"
          onClick={toggleSidebar}
        >
          <NotebookTabs size={17} />
        </button>

        <button className="icon-command" title={`Theme: ${themeLabel(theme)}`} onClick={cycleTheme}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <main className={`workspace layout-${layout} ${sidebarOpen ? 'with-notes' : ''}`}>
        {sidebarOpen && <NotesSidebar onOpenNote={(note) => void openNote(note)} onCreateNote={(group) => void createNote(group)} />}
        {visible.editor && <EditorPane ref={editorRef} fullMode={layout === 'full'} />}
        {visible.preview && <PreviewPane html={html} />}
        <Toolbar editorRef={editorRef} />
      </main>

      <StatusBar />
      <div className={`toast ${notice ? 'show' : ''}`}>{notice}</div>
    </div>
  );
}
