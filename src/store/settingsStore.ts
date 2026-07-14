import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode, ThemeMode } from '../types';

interface SettingsState {
  layout: LayoutMode;
  theme: ThemeMode;
  showLineNumbers: boolean;
  recentFiles: string[];
  sidebarOpen: boolean;
  sidebarWidth: number;
  // โฟลเดอร์หลักที่เก็บโน้ต — null = ค่าเริ่มต้น (Documents\PlainMark)
  notesRoot: string | null;
  zoom: number;
  // ประวัติเวอร์ชันโน้ต: รอบเก็บอัตโนมัติ (นาที) และจำนวนเวอร์ชันสูงสุดต่อโน้ต
  historyIntervalMin: number;
  historyKeep: number;
  // path ของโน้ต/กลุ่มที่ผู้ใช้ซ่อนจากแถบข้าง (ไฟล์จริงยังอยู่ ยกเลิกซ่อนได้จากแผงรายการที่ซ่อน)
  hiddenPaths: string[];
  setLayout: (layout: LayoutMode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleLineNumbers: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  addRecentFile: (path: string) => void;
  setNotesRoot: (path: string | null) => void;
  setZoom: (zoom: number) => void;
  setHistoryIntervalMin: (minutes: number) => void;
  setHistoryKeep: (count: number) => void;
  hidePath: (path: string) => void;
  unhidePath: (path: string) => void;
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
      sidebarWidth: 280,
      notesRoot: null,
      zoom: 1,
      historyIntervalMin: 5,
      historyKeep: 30,
      hiddenPaths: [],
      setLayout: (layout) => set({ layout }),
      setTheme: (theme) => set({ theme }),
      toggleLineNumbers: () => set((state) => ({ showLineNumbers: !state.showLineNumbers })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.min(520, Math.max(200, Math.round(width))) }),
      addRecentFile: (path) =>
        set((state) => ({
          recentFiles: [path, ...state.recentFiles.filter((item) => item !== path)].slice(0, recentLimit)
        })),
      setNotesRoot: (path) => set({ notesRoot: path }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      // จำกัดช่วงกันตั้งค่าเพี้ยน (เช่น 0 นาที = เก็บทุกครั้งที่เซฟ จะได้ไฟล์ประวัติถี่เกิน)
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
      name: 'plainmark:settings',
      version: 1,
      partialize: (state) => ({
        layout: state.layout,
        theme: state.theme,
        showLineNumbers: state.showLineNumbers,
        recentFiles: state.recentFiles,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        notesRoot: state.notesRoot,
        zoom: state.zoom,
        historyIntervalMin: state.historyIntervalMin,
        historyKeep: state.historyKeep,
        hiddenPaths: state.hiddenPaths
      })
    }
  )
);
