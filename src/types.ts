export type LayoutMode = 'split' | 'editor' | 'preview';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface CursorPosition {
  line: number;
  column: number;
}

export interface FileRecord {
  path: string | null;
  name: string;
}

export interface FormatResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface EditorApi {
  focus: () => void;
  getSelection: () => { from: number; to: number };
  replaceContent: (content: string, selectionStart?: number, selectionEnd?: number) => void;
}
