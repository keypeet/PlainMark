import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  apiDiscoverClis,
  apiGetSettings,
  apiUpdateSettings,
  type BackendSettings,
  type CliCache
} from '../lib/api';
import type { AccentId, EditorWidthPreset, FontId, ThemeMode, ViewMode } from '../types';

export function clampZoom(zoom: number): number {
  return Math.min(2.5, Math.max(0.6, Math.round(zoom * 100) / 100));
}

export function clampFontSize(size: number): number {
  return Math.min(17, Math.max(13, Math.round(size) || 15));
}

interface SettingsState {
  viewMode: ViewMode;
  theme: ThemeMode;
  accentColor: AccentId;
  fontFamily: FontId;
  fontSize: number;
  editorWidth: EditorWidthPreset;
  showLineNumbers: boolean;
  wordWrap: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  zoom: number;
  historyIntervalMin: number;
  historyKeep: number;
  hiddenPaths: string[];
  backendSettings: BackendSettings | null;
  cliCache: CliCache | null;

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setTheme: (theme: ThemeMode) => void;
  setAccentColor: (accent: AccentId) => void;
  setFontFamily: (font: FontId) => void;
  setFontSize: (size: number) => void;
  setEditorWidth: (width: EditorWidthPreset) => void;
  resetAppearance: () => void;
  toggleLineNumbers: () => void;
  toggleWordWrap: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setZoom: (zoom: number) => void;
  setHistoryIntervalMin: (minutes: number) => void;
  setHistoryKeep: (count: number) => void;
  hidePath: (path: string) => void;
  unhidePath: (path: string) => void;
  loadBackendSettings: () => Promise<void>;
  patchBackendSettings: (patch: Record<string, unknown>) => Promise<void>;
  refreshCliCache: () => Promise<CliCache | null>;
}

function syncAppearanceToBackend(appearance: {
  themeMode?: ThemeMode;
  accentColor?: AccentId;
  fontFamily?: FontId;
  fontSize?: number;
}) {
  if (typeof fetch !== 'function') return;
  void apiUpdateSettings({ appearance }).catch(() => {
    // Offline or test environment: keep local settings responsive
  });
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      viewMode: 'formatted',
      theme: 'system',
      accentColor: 'indigo',
      fontFamily: 'ibm-plex',
      fontSize: 15,
      editorWidth: 'wide',
      showLineNumbers: false,
      wordWrap: true,
      sidebarOpen: true,
      sidebarWidth: 270,
      zoom: 1,
      historyIntervalMin: 5,
      historyKeep: 30,
      hiddenPaths: [],
      backendSettings: null,
      cliCache: null,

      setViewMode: (viewMode) => set({ viewMode }),
      toggleViewMode: () =>
        set((state) => ({ viewMode: state.viewMode === 'formatted' ? 'syntax' : 'formatted' })),
      setTheme: (theme) => {
        set({ theme });
        syncAppearanceToBackend({ themeMode: theme });
      },
      setAccentColor: (accentColor) => {
        set({ accentColor });
        syncAppearanceToBackend({ accentColor });
      },
      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        syncAppearanceToBackend({ fontFamily });
      },
      setFontSize: (size) => {
        const fontSize = clampFontSize(size);
        set({ fontSize });
        syncAppearanceToBackend({ fontSize });
      },
      setEditorWidth: (editorWidth) => set({ editorWidth }),
      resetAppearance: () => {
        set({
          theme: 'system',
          accentColor: 'indigo',
          fontFamily: 'ibm-plex',
          fontSize: 15,
          editorWidth: 'wide'
        });
        syncAppearanceToBackend({
          themeMode: 'system',
          accentColor: 'indigo',
          fontFamily: 'ibm-plex',
          fontSize: 15
        });
      },
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
      unhidePath: (path) => set((state) => ({ hiddenPaths: state.hiddenPaths.filter((item) => item !== path) })),

      loadBackendSettings: async () => {
        try {
          const { settings, cliCache } = await apiGetSettings();
          const app = settings.appearance;
          set({
            backendSettings: settings,
            cliCache,
            theme: app.themeMode || get().theme,
            accentColor: (app.accentColor as AccentId) || get().accentColor,
            fontFamily: (app.fontFamily as FontId) || get().fontFamily,
            fontSize: clampFontSize(app.fontSize ?? get().fontSize)
          });
        } catch {
          // Backend offline
        }
      },

      patchBackendSettings: async (patch) => {
        const res = await apiUpdateSettings(patch);
        set({ backendSettings: res.settings });
      },

      refreshCliCache: async () => {
        const cache = await apiDiscoverClis();
        set({ cliCache: cache });
        return cache;
      }
    }),
    {
      name: 'plainmark:settings:v2',
      version: 3,
      partialize: (state) => ({
        viewMode: state.viewMode,
        theme: state.theme,
        accentColor: state.accentColor,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        editorWidth: state.editorWidth,
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
