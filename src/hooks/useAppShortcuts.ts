import { useEffect } from 'react';

interface AppShortcutHandlers {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  changeZoom: (delta: number | null) => void;
}

// คีย์ลัดระดับแอป: Ctrl+N / Ctrl+O / Ctrl+S และซูม Ctrl+= / Ctrl+- / Ctrl+0
// (คีย์ลัดจัดรูปแบบข้อความอยู่ที่ Toolbar)
export function useAppShortcuts({ onNew, onOpen, onSave, changeZoom }: AppShortcutHandlers) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        onSave();
      }
      if (key === 'o') {
        event.preventDefault();
        onOpen();
      }
      if (key === 'n') {
        event.preventDefault();
        onNew();
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
  }, [changeZoom, onNew, onOpen, onSave]);
}
