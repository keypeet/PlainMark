import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode, ThemeMode } from '../types';

interface SettingsState {
  layout: LayoutMode;
  theme: ThemeMode;
  showLineNumbers: boolean;
  recentFiles: string[];
  sidebarOpen: boolean;
  setLayout: (layout: LayoutMode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleLineNumbers: () => void;
  toggleSidebar: () => void;
  addRecentFile: (path: string) => void;
}

const recentLimit = 8;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      layout: 'split',
      theme: 'system',
      showLineNumbers: true,
      recentFiles: [],
      sidebarOpen: true,
      setLayout: (layout) => set({ layout }),
      setTheme: (theme) => set({ theme }),
      toggleLineNumbers: () => set((state) => ({ showLineNumbers: !state.showLineNumbers })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      addRecentFile: (path) =>
        set((state) => ({
          recentFiles: [path, ...state.recentFiles.filter((item) => item !== path)].slice(0, recentLimit)
        }))
    }),
    {
      name: 'plainmark:settings',
      version: 1,
      partialize: (state) => ({
        layout: state.layout,
        theme: state.theme,
        showLineNumbers: state.showLineNumbers,
        recentFiles: state.recentFiles,
        sidebarOpen: state.sidebarOpen
      })
    }
  )
);
