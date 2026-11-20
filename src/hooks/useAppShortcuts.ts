import { useEffect } from 'react';

interface AppShortcutHandlers {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAll: () => void;
  onCloseTab: () => void;
  onFind: (withReplace: boolean) => void;
  onGoToLine: () => void;
  onGlobalSearch: () => void;
  onToggleViewMode: () => void;
  changeZoom: (delta: number | null) => void;
}

export function useAppShortcuts(handlers: AppShortcutHandlers) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      if (key === 's' && event.shiftKey) {
        event.preventDefault();
        handlers.onSaveAll();
      } else if (key === 's') {
        event.preventDefault();
        handlers.onSave();
      } else if (key === 'o') {
        event.preventDefault();
        handlers.onOpen();
      } else if (key === 'n') {
        event.preventDefault();
        handlers.onNew();
      } else if (key === 'w') {
        event.preventDefault();
        handlers.onCloseTab();
      } else if (key === 'f' && !event.shiftKey) {
        event.preventDefault();
        handlers.onFind(false);
      } else if (key === 'h' && !event.shiftKey) {
        event.preventDefault();
        handlers.onFind(true);
      } else if (key === 'g' && !event.shiftKey) {
        event.preventDefault();
        handlers.onGoToLine();
      } else if (key === 'k' && event.shiftKey) {
        event.preventDefault();
        handlers.onGlobalSearch();
      } else if (key === 'p' && !event.shiftKey) {
        event.preventDefault();
        handlers.onGlobalSearch();
      } else if (key === 'm' && event.shiftKey) {
        event.preventDefault();
        handlers.onToggleViewMode();
      } else if (key === '=' || key === '+') {
        event.preventDefault();
        handlers.changeZoom(0.1);
      } else if (key === '-') {
        event.preventDefault();
        handlers.changeZoom(-0.1);
      } else if (key === '0') {
        event.preventDefault();
        handlers.changeZoom(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlers]);
}
