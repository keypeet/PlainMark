import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode, ViewMode } from '../types';

interface SettingsState {
  viewMode: ViewMode;
  theme: ThemeMode;
  showLineNumbers: boolean;
  wordWrap: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  zoom: number;
  historyIntervalMin: number;
  historyKeep: number;
  hiddenPaths: string[];

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleLineNumbers: () => void;
  toggleWordWrap: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setZoom: (zoom: number) => void;
  setHistoryIntervalMin: (minutes: number) => void;
  setHistoryKeep: (count: number) => void;
  hidePath: (path: string) => void;
  unhidePath: (path: string) => void;
}

export function clampZoom(zoom: number): number {
  return Math.min(2.5, Math.max(0.6, Math.round(zoom * 100) / 100));
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      viewMode: 'formatted',
      theme: 'system',
      showLineNumbers: false,
      wordWrap: true,
      sidebarOpen: true,
      sidebarWidth: 270,
      zoom: 1,
      historyIntervalMin: 5,
      historyKeep: 30,
      hiddenPaths: [],

      setViewMode: (viewMode) => set({ viewMode }),
      toggleViewMode: () =>
        set((state) => ({ viewMode: state.viewMode === 'formatted' ? 'syntax' : 'formatted' })),
      setTheme: (theme) => set({ theme }),
      toggleLineNumbers: () => set((state) => ({ showLineNumbers: !state.showLineNumbers })),
      toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.min(460, Math.max(200, Math.round(width))) }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      setHistoryIntervalMin: (minutes) =>
        set({ historyIntervalMin: Math.min(120, Math.max(1, Math.round(minutes) || 1)) }),
      setHistoryKeep: (count) => set({ historyKeep: Math.min(100, Math.max(1, Math.round(count) || 1)) }),
      hidePath: (path) =>
        set((state) => ({
          hiddenPaths: state.hiddenPaths.includes(path) ? state.hiddenPaths : [...state.hiddenPaths, path]
        })),
      unhidePath: (path) => set((state) => ({ hiddenPaths: state.hiddenPaths.filter((item) => item !== path) }))
    }),
    {
      name: 'plainmark:settings:v2',
      version: 2,
      partialize: (state) => ({
        viewMode: state.viewMode,
        theme: state.theme,
        showLineNumbers: state.showLineNumbers,
        wordWrap: state.wordWrap,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        zoom: state.zoom,
        historyIntervalMin: state.historyIntervalMin,
        historyKeep: state.historyKeep,
        hiddenPaths: state.hiddenPaths
      })
    }
  )
);
