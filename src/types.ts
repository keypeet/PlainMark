export type LayoutMode = 'split' | 'editor' | 'preview' | 'full';

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
  // พาไปพิมพ์ช่องแรกของกริดตารางที่ตำแหน่งนั้น (โหมด full หลังแทรกตาราง — โหมดอื่นเป็น no-op)
  focusTableCellAt: (pos: number) => void;
}
