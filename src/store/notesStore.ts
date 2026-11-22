import { create } from 'zustand';
import {
  apiCreateNote,
  apiCreateScratch,
  apiDeleteScratch,
  apiHealth,
  apiImportLegacy,
  apiListClosedItems,
  apiListNotes,
  apiListScratches,
  apiPromoteScratch,
  apiRecordClosedItem,
  apiRestoreClosedItem,
  type ClosedItem,
  type ScratchDoc,
  type ScratchMeta
} from '../lib/api';
import type { NoteMeta, ProjectMeta } from '../lib/noteService';
import {
  createNote,
  createProject,
  deleteNote,
  deleteProject,
  enqueueNoteOp,
  loadProjects,
  moveNote,
  renameNote,
  updateProject
} from '../lib/noteService';

interface NotesState {
  projects: ProjectMeta[];
  generalNotes: NoteMeta[];
  scratches: ScratchMeta[];
  closedItems: ClosedItem[];
  activeScope: string;
  dataRoot: string;
  loaded: boolean;
  backendOnline: boolean;
  legacyAvailable: boolean;
  legacyPath: string;
  selectedProjectSlug: string | null;

  setActiveScope: (scope: string) => void;
  selectProject: (slug: string | null) => void;
  refresh: () => Promise<void>;
  refreshScratches: () => Promise<void>;
  refreshClosedItems: () => Promise<void>;
  addProject: (name: string, repoPath?: string | null) => Promise<ProjectMeta | null>;
  editProject: (
    slug: string,
    patch: {
      name?: string;
      repoPath?: string | null;
      glossary?: string[];
      hidden?: boolean;
      defaultVisibility?: 'local_only' | 'shareable';
    }
  ) => Promise<ProjectMeta | null>;
  toggleProjectHidden: (slug: string, hidden: boolean) => Promise<void>;
  removeProject: (slug: string) => Promise<void>;
  addNote: (projectSlug?: string, title?: string) => Promise<NoteMeta | null>;
  addNoteInScope: (scope: string, title?: string) => Promise<NoteMeta | null>;
  renameNoteAt: (notePath: string, newTitle: string) => Promise<NoteMeta | null>;
  moveNoteTo: (notePath: string, targetProjectSlug: string) => Promise<NoteMeta | null>;
  removeNote: (notePath: string) => Promise<void>;
  addScratch: (title?: string, content?: string) => Promise<ScratchDoc | null>;
  removeScratch: (scratchId: string) => Promise<void>;
  promoteScratch: (scratchId: string, targetScope: string, title?: string) => Promise<NoteMeta | null>;
  recordClosedItem: (payload: {
    itemType: 'card' | 'note' | 'scratch';
    scope: string;
    title: string;
    reason: string;
    assignee?: string;
    note?: string;
    snapshot?: Record<string, unknown>;
  }) => Promise<ClosedItem | null>;
  restoreClosedItem: (itemId: string) => Promise<void>;
  importLegacy: () => Promise<{ importedProjects: number; importedNotes: number } | null>;
}

export const useNotesStore = create<NotesState>((set, get) => {
  const refreshInternal = async () => {
    try {
      const [{ dataRoot, projects }, generalRes, scratchesRes, health] = await Promise.all([
        loadProjects(),
        apiListNotes('general').catch(() => ({ notes: [] })),
        apiListScratches().catch(() => ({ scratches: [] })),
        apiHealth().catch(() => null)
      ]);
      set((state) => ({
        projects,
        generalNotes: generalRes.notes,
        scratches: scratchesRes.scratches,
        dataRoot,
        loaded: true,
        backendOnline: true,
        legacyAvailable: health?.legacyNotesAvailable ?? state.legacyAvailable,
        legacyPath: health?.legacyNotesPath ?? state.legacyPath,
        selectedProjectSlug:
          state.selectedProjectSlug && projects.some((p) => p.slug === state.selectedProjectSlug)
            ? state.selectedProjectSlug
            : projects[0]?.slug ?? null
      }));
    } catch (error) {
      console.error('PlainMark: load projects failed', error);
      set({ loaded: true, backendOnline: false });
    }
  };

  return {
    projects: [],
    generalNotes: [],
    scratches: [],
    closedItems: [],
    activeScope: 'all',
    dataRoot: '',
    loaded: false,
    backendOnline: true,
    legacyAvailable: false,
    legacyPath: '',
    selectedProjectSlug: null,

    setActiveScope: (scope) => {
      if (scope.startsWith('project:')) {
        set({ activeScope: scope, selectedProjectSlug: scope.slice('project:'.length) });
      } else {
        set({ activeScope: scope });
      }
    },

    selectProject: (slug) =>
      set({
        selectedProjectSlug: slug,
        activeScope: slug ? `project:${slug}` : 'all'
      }),

    refresh: () => enqueueNoteOp(refreshInternal),

    refreshScratches: async () => {
      try {
        const res = await apiListScratches();
        set({ scratches: res.scratches });
      } catch {
        // ignore offline
      }
    },

    refreshClosedItems: async () => {
      try {
        const res = await apiListClosedItems();
        set({ closedItems: res.items });
      } catch {
        // ignore offline
      }
    },

    addProject: (name, repoPath) =>
      enqueueNoteOp(async () => {
        try {
          const created = await createProject(name, repoPath);
          await refreshInternal();
          set({ selectedProjectSlug: created.slug, activeScope: `project:${created.slug}` });
          return created;
        } catch (error) {
          console.error('PlainMark: create project failed', error);
          return null;
        }
      }),

    editProject: (slug, patch) =>
      enqueueNoteOp(async () => {
        const updated = await updateProject(slug, patch);
        if (get().selectedProjectSlug === slug) {
          set({ selectedProjectSlug: updated.slug, activeScope: `project:${updated.slug}` });
        }
        await refreshInternal();
        return updated;
      }),

    toggleProjectHidden: (slug, hidden) =>
      enqueueNoteOp(async () => {
        await updateProject(slug, { hidden });
        if (hidden && get().activeScope === `project:${slug}`) {
          set({ activeScope: 'all' });
        }
        await refreshInternal();
      }),

    removeProject: (slug) =>
      enqueueNoteOp(async () => {
        await deleteProject(slug);
        if (get().activeScope === `project:${slug}`) {
          set({ activeScope: 'all' });
        }
        await refreshInternal();
      }),

    addNote: (projectSlug, title) =>
      enqueueNoteOp(async () => {
        try {
          const target = projectSlug ?? get().selectedProjectSlug ?? undefined;
          const note = await createNote(target, title);
          await refreshInternal();
          return note;
        } catch (error) {
          console.error('PlainMark: create note failed', error);
          return null;
        }
      }),

    addNoteInScope: (scope, title) =>
      enqueueNoteOp(async () => {
        try {
          const targetScope = scope === 'all' ? 'general' : scope;
          const note = await apiCreateNote(undefined, title, targetScope);
          await refreshInternal();
          return note;
        } catch (error) {
          console.error('PlainMark: create note in scope failed', error);
          return null;
        }
      }),

    renameNoteAt: (notePath, newTitle) =>
      enqueueNoteOp(async () => {
        try {
          const note = await renameNote(notePath, newTitle);
          await refreshInternal();
          return note;
        } catch (error) {
          console.error('PlainMark: rename note failed', error);
          return null;
        }
      }),

    moveNoteTo: (notePath, targetProjectSlug) =>
      enqueueNoteOp(async () => {
        try {
          const note = await moveNote(notePath, targetProjectSlug);
          await refreshInternal();
          return note;
        } catch (error) {
          console.error('PlainMark: move note failed', error);
          return null;
        }
      }),

    removeNote: (notePath) =>
      enqueueNoteOp(async () => {
        await deleteNote(notePath);
        await refreshInternal();
      }),

    addScratch: async (title, content = '') => {
      try {
        const created = await apiCreateScratch(title, content);
        await get().refreshScratches();
        return created;
      } catch (error) {
        console.error('PlainMark: create scratch failed', error);
        return null;
      }
    },

    removeScratch: async (scratchId) => {
      await apiDeleteScratch(scratchId);
      await get().refreshScratches();
    },

    promoteScratch: async (scratchId, targetScope, title) => {
      const res = await apiPromoteScratch(scratchId, targetScope, title, false);
      await refreshInternal();
      return res.note;
    },

    recordClosedItem: async (payload) => {
      const item = await apiRecordClosedItem(payload);
      await get().refreshClosedItems();
      return item;
    },

    restoreClosedItem: async (itemId) => {
      await apiRestoreClosedItem(itemId);
      await refreshInternal();
      await get().refreshClosedItems();
    },

    importLegacy: () =>
      enqueueNoteOp(async () => {
        try {
          const result = await apiImportLegacy();
          await refreshInternal();
          return { importedProjects: result.importedProjects, importedNotes: result.importedNotes };
        } catch (error) {
          console.error('PlainMark: legacy import failed', error);
          return null;
        }
      })
  };
});
