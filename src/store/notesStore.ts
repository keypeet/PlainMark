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

interface NotesState {
  groups: GroupMeta[];
  loaded: boolean;
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

  refresh: async () => {
    if (!notesSupported) {
      set({ groups: [], loaded: true });
      return;
    }
    try {
      set({ groups: await loadTree(), loaded: true });
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
    await renameGroup(groupPath, newName);
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
