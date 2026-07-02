import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode, ThemeMode } from '../types';

interface SettingsState {
  layout: LayoutMode;
  theme: ThemeMode;
  showLineNumbers: boolean;
  recentFiles: string[];
  sidebarOpen: boolean;
  // โฟลเดอร์หลักที่เก็บโน้ต — null = ค่าเริ่มต้น (Documents\PlainMark)
  notesRoot: string | null;
  zoom: number;
  setLayout: (layout: LayoutMode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleLineNumbers: () => void;
  toggleSidebar: () => void;
  addRecentFile: (path: string) => void;
  setNotesRoot: (path: string | null) => void;
  setZoom: (zoom: number) => void;
}

const recentLimit = 8;

// ระดับซูมของทั้งแอป — จำกัด 50%–250% กันเผลอซูมจนใช้งานไม่ได้
export function clampZoom(zoom: number): number {
  return Math.min(2.5, Math.max(0.5, Math.round(zoom * 100) / 100));
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      layout: 'split',
      theme: 'system',
      showLineNumbers: true,
      recentFiles: [],
      sidebarOpen: true,
      notesRoot: null,
      zoom: 1,
      setLayout: (layout) => set({ layout }),
      setTheme: (theme) => set({ theme }),
      toggleLineNumbers: () => set((state) => ({ showLineNumbers: !state.showLineNumbers })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      addRecentFile: (path) =>
        set((state) => ({
          recentFiles: [path, ...state.recentFiles.filter((item) => item !== path)].slice(0, recentLimit)
        })),
      setNotesRoot: (path) => set({ notesRoot: path }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) })
    }),
    {
      name: 'plainmark:settings',
      version: 1,
      partialize: (state) => ({
        layout: state.layout,
        theme: state.theme,
        showLineNumbers: state.showLineNumbers,
        recentFiles: state.recentFiles,
        sidebarOpen: state.sidebarOpen,
        notesRoot: state.notesRoot,
        zoom: state.zoom
      })
    }
  )
);
