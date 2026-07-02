import { create } from 'zustand';
import type { GroupMeta } from '../lib/noteService';
import {
  createGroup,
  createNote,
  deleteGroup,
  deleteNote,
  loadTree,
  moveNote,
  notesSupported,
  renameGroup,
  renameNote
} from '../lib/noteService';
import type { NoteMeta } from '../lib/noteService';
import { baseName } from '../lib/paths';

interface NotesState {
  groups: GroupMeta[];
  loaded: boolean;
  // กลุ่มที่ผู้ใช้เลือกล่าสุด (คลิกหัวกลุ่ม หรือเปิดโน้ตในกลุ่มนั้น) — เป็นปลายทางของปุ่ม New
  selectedGroup: string | null;
  selectGroup: (name: string | null) => void;
  refresh: () => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  addNote: (groupName?: string, title?: string) => Promise<NoteMeta | null>;
  renameNoteAt: (notePath: string, newTitle: string) => Promise<NoteMeta | null>;
  renameGroupAt: (groupPath: string, newName: string) => Promise<void>;
  moveNoteTo: (notePath: string, targetGroupName: string) => Promise<NoteMeta | null>;
  removeNote: (notePath: string) => Promise<void>;
  removeGroup: (groupPath: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  groups: [],
  loaded: false,
  selectedGroup: null,

  selectGroup: (name) => set({ selectedGroup: name }),

  refresh: async () => {
    if (!notesSupported) {
      set({ groups: [], loaded: true });
      return;
    }
    try {
      const groups = await loadTree();
      // กลุ่มที่เลือกไว้ถูกลบ/เปลี่ยนชื่อไปแล้ว → ล้างการเลือก (ปุ่ม New จะ fallback ตามลำดับปกติ)
      set((state) => ({
        groups,
        loaded: true,
        selectedGroup:
          state.selectedGroup && groups.some((group) => group.name === state.selectedGroup)
            ? state.selectedGroup
            : null
      }));
    } catch (error) {
      console.error('PlainMark: load notes tree failed', error);
      set({ loaded: true });
    }
  },

  addGroup: async (name) => {
    await createGroup(name);
    await get().refresh();
  },

  addNote: async (groupName, title) => {
    try {
      const note = await createNote(groupName, title);
      await get().refresh();
      return note;
    } catch (error) {
      console.error('PlainMark: create note failed', error);
      return null;
    }
  },

  renameNoteAt: async (notePath, newTitle) => {
    try {
      const note = await renameNote(notePath, newTitle);
      await get().refresh();
      return note;
    } catch (error) {
      console.error('PlainMark: rename note failed', error);
      return null;
    }
  },

  renameGroupAt: async (groupPath, newName) => {
    const oldName = baseName(groupPath);
    const newPath = await renameGroup(groupPath, newName);
    // ถ้ากลุ่มที่เลือกอยู่คือกลุ่มที่ถูกเปลี่ยนชื่อ ให้การเลือกตามไปชื่อใหม่
    if (get().selectedGroup === oldName) {
      set({ selectedGroup: baseName(newPath) || null });
    }
    await get().refresh();
  },

  moveNoteTo: async (notePath, targetGroupName) => {
    try {
      const note = await moveNote(notePath, targetGroupName);
      await get().refresh();
      return note;
    } catch (error) {
      console.error('PlainMark: move note failed', error);
      return null;
    }
  },

  removeNote: async (notePath) => {
    await deleteNote(notePath);
    await get().refresh();
  },

  removeGroup: async (groupPath) => {
    await deleteGroup(groupPath);
    await get().refresh();
  }
}));
