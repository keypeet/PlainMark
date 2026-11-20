export type ViewMode = 'formatted' | 'syntax';

export type AppSection = 'notes' | 'meetings' | 'knowledge' | 'insights';

export type ThemeMode = 'light' | 'dark' | 'system';

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
