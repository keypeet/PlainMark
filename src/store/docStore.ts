import { create } from 'zustand';
import type { CursorPosition, FileRecord } from '../types';

export interface HydrateSession {
  content: string;
  filePath: string | null;
  fileName: string;
  notePath: string | null;
  dirty: boolean;
}

interface DocState {
  content: string;
  file: FileRecord;
  notePath: string | null;
  dirty: boolean;
  cursor: CursorPosition;
  lastSavedContent: string;
  setContent: (content: string, markDirty?: boolean) => void;
  setCursor: (cursor: CursorPosition) => void;
  setFile: (file: FileRecord) => void;
  setNotePath: (notePath: string | null) => void;
  markSaved: (content?: string) => void;
  newDocument: () => void;
  hydrate: (session: HydrateSession) => void;
}

const initialContent = `# PlainMark
พิมพ์ข้อความธรรมดา แล้วเห็น Markdown Preview แบบเรียลไทม์

## เริ่มใช้งาน
- เลือกข้อความแล้วกดปุ่มด้านขวาเพื่อจัดรูปแบบ
- ลองกด **Bold**, *Italic*, Table หรือ Code Block
- ก็อปรูปแล้ววางใน editor เพื่อฝังเป็น base64

> Plain text first, Markdown when you need it.
`;

// sentinel ต่อท้ายที่ผู้ใช้พิมพ์เองไม่ได้ เพื่อให้สถานะ dirty คงอยู่หลังกู้คืน session
const dirtySentinel = '\u0000';

export const useDocStore = create<DocState>((set, get) => ({
  content: initialContent,
  file: { path: null, name: 'untitled.md' },
  notePath: null,
  dirty: false,
  cursor: { line: 1, column: 1 },
  lastSavedContent: initialContent,
  setContent: (content, markDirty = true) => {
    const lastSavedContent = get().lastSavedContent;
    set({ content, dirty: markDirty ? content !== lastSavedContent : get().dirty });
  },
  setCursor: (cursor) => set({ cursor }),
  setFile: (file) => set({ file }),
  setNotePath: (notePath) => set({ notePath }),
  markSaved: (content) => {
    const savedContent = content ?? get().content;
    set({ dirty: false, lastSavedContent: savedContent });
  },
  newDocument: () =>
    set({
      content: '',
      file: { path: null, name: 'untitled.md' },
      notePath: null,
      dirty: false,
      cursor: { line: 1, column: 1 },
      lastSavedContent: ''
    }),
  hydrate: (session) =>
    set({
      content: session.content,
      file: { path: session.filePath, name: session.fileName },
      notePath: session.notePath,
      dirty: session.dirty,
      cursor: { line: 1, column: 1 },
      lastSavedContent: session.dirty ? session.content + dirtySentinel : session.content
    })
}));
