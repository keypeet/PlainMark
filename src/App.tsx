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
  Sun
} from 'lucide-react';
import { EditorPane } from './components/EditorPane';
import { NotesSidebar } from './components/NotesSidebar';
import { PreviewPane } from './components/PreviewPane';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { renderMarkdown } from './lib/markdownEngine';
import { flushSession, loadSession, saveSession } from './lib/session';
import { flushNoteWrites, noteGroupName, notesSupported, readNote, writeNoteQueued } from './lib/noteService';
import type { NoteMeta } from './lib/noteService';
import { exportTextFile, openTextFile, saveTextFile } from './lib/fileService';
import { useDocStore } from './store/docStore';
import { useNotesStore } from './store/notesStore';
import { useSettingsStore } from './store/settingsStore';
import type { EditorApi, LayoutMode, ThemeMode } from './types';

function useRenderedMarkdown(content: string): string {
  const [html, setHtml] = useState(() => renderMarkdown(content));

  useEffect(() => {
    const timer = window.setTimeout(() => setHtml(renderMarkdown(content)), 40);
    return () => window.clearTimeout(timer);
  }, [content]);

  return html;
}

function themeLabel(theme: ThemeMode): string {
  if (theme === 'dark') return 'Dark';
  if (theme === 'light') return 'Light';
  return 'System';
}

// รวบรวมสถานะปัจจุบันแล้วบันทึก session + เนื้อหาโน้ต (ถ้าเปิดโน้ตอยู่)
function persistNow(): Promise<void> {
  const { content, file, notePath, dirty } = useDocStore.getState();
  const tasks: Promise<void>[] = [
    saveSession({
      content,
      filePath: file.path,
      fileName: file.name,
      notePath,
      dirty,
      updatedAt: Date.now()
    })
  ];
  if (notePath) tasks.push(writeNoteQueued(notePath, content));
  return Promise.all(tasks).then(() => undefined);
}

export default function App() {
  const editorRef = useRef<EditorApi | null>(null);
  const sessionReady = useRef(false);
  const [notice, setNotice] = useState('');
  const { content, file, notePath, dirty, setContent, setFile, setNotePath, markSaved, newDocument, hydrate } =
    useDocStore();
  const { layout, theme, sidebarOpen, zoom, setLayout, setTheme, toggleSidebar, addRecentFile } = useSettingsStore();
  const html = useRenderedMarkdown(content);

  const visible = useMemo(
    () => ({
      editor: layout === 'split' || layout === 'editor',
      preview: layout === 'split' || layout === 'preview'
    }),
    [layout]
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 1800);
  }, []);

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

  // ซูมทั้งแอป — delta เป็นขั้น ±0.1, null = รีเซ็ตกลับ 100%
  const changeZoom = useCallback(
    (delta: number | null) => {
      const { zoom: current, setZoom } = useSettingsStore.getState();
      const next = delta === null ? 1 : current + delta;
      setZoom(next);
      showNotice(`ซูม ${Math.round(useSettingsStore.getState().zoom * 100)}%`);
    },
    [showNotice]
  );

  // ปรับซูมจริงผ่าน webview ทุกครั้งที่ค่าเปลี่ยน (รวมตอนเปิดแอป — คืนค่าที่จำไว้)
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(zoom);
    })().catch((error) => console.error('PlainMark: set zoom failed', error));
  }, [zoom]);

  // Ctrl + ลูกกลิ้งเมาส์ = ซูมเข้า/ออก
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [changeZoom]);

  // กู้คืน session เงียบๆ ตอนเปิดแอป (แบบ Notepad — ไม่ถาม ไม่มีทางหาย)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadSession();
        if (!cancelled && session && !useDocStore.getState().dirty) {
          hydrate({
            content: session.content,
            filePath: session.filePath,
            fileName: session.fileName,
            notePath: session.notePath,
            dirty: session.dirty
          });
        }
      } finally {
        sessionReady.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // บันทึกออโต้เสมอ (ไม่สนว่า dirty หรือไม่) — คงสภาพล่าสุดไว้ให้เปิดกลับมาเหมือนเดิม
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sessionReady.current) return;
      void persistNow().then(() => {
        const state = useDocStore.getState();
        if (state.notePath && state.content === content) state.markSaved(content);
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, file.path, file.name, notePath, dirty]);

  // flush ก่อนหน้าต่างปิดจริง — หัวใจของ "กด X แล้วงานไม่หาย"
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlisten: (() => void) | undefined;
    let closing = false;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event) => {
        if (closing) return;
        closing = true;
        event.preventDefault();
        try {
          await Promise.race([
            persistNow().then(() => Promise.all([flushSession(), flushNoteWrites()])),
            new Promise((resolve) => setTimeout(resolve, 3000))
          ]);
        } finally {
          await win.destroy();
        }
      });
    })();
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void handleSave();
      }
      if (key === 'o') {
        event.preventDefault();
        void handleOpen();
      }
      if (key === 'n') {
        event.preventDefault();
        handleNew();
      }
      if (key === '=' || key === '+') {
        event.preventDefault();
        changeZoom(0.1);
      }
      if (key === '-') {
        event.preventDefault();
        changeZoom(-0.1);
      }
      if (key === '0') {
        event.preventDefault();
        changeZoom(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [changeZoom, handleNew, handleOpen, handleSave]);

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
          {(['split', 'editor', 'preview'] as LayoutMode[]).map((mode) => (
            <button key={mode} className={layout === mode ? 'active' : ''} onClick={() => setLayout(mode)}>
              {mode === 'split' && <PanelLeft size={15} />}
              {mode === 'editor' && <PanelRight size={15} />}
              {mode === 'preview' && <Eye size={15} />}
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
        {visible.editor && <EditorPane ref={editorRef} />}
        {visible.preview && <PreviewPane html={html} />}
        <Toolbar editorRef={editorRef} />
      </main>

      <StatusBar />
      <div className={`toast ${notice ? 'show' : ''}`}>{notice}</div>
    </div>
  );
}
