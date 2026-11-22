export type ViewMode = 'formatted' | 'syntax';

export type AppSection = 'insights' | 'notes' | 'meetings' | 'knowledge' | 'settings';

export type ThemeMode = 'light' | 'dark' | 'system';

export type AccentId = 'indigo' | 'teal' | 'forest' | 'amber' | 'rose' | 'plum' | 'slate' | 'ocean';

export type FontId = 'ibm-plex' | 'sarabun' | 'noto-sans' | 'noto-serif';

export type EditorWidthPreset = 'narrow' | 'wide' | 'full';

export type LineEnding = 'LF' | 'CRLF';

export interface CursorPosition {
  line: number;
  column: number;
}

export interface FileRecord {
  path: string | null;
  name: string;
}

export interface TabDocument {
  id: string;
  title: string;
  notePath: string | null;
  projectSlug: string | null;
  scratchId?: string | null;
  scope?: string | null;
  content: string;
  lastSavedContent: string;
  dirty: boolean;
  lineEnding: LineEnding;
  cursor: CursorPosition;
}

export interface FormatResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface SearchStats {
  total: number;
  current: number;
}

export interface EditorApi {
  focus: () => void;
  getSelection: () => { from: number; to: number };
  replaceContent: (content: string, selectionStart?: number, selectionEnd?: number) => void;
  focusTableCellAt: (pos: number) => void;
  goToLine: (lineNumber: number) => boolean;
  setSearch: (query: string, matchCase: boolean) => SearchStats;
  findNext: () => SearchStats;
  findPrev: () => SearchStats;
  replaceCurrent: (replacement: string) => SearchStats;
  replaceAll: (replacement: string) => number;
}
