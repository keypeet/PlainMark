import { create } from 'zustand';
import { apiHealth, apiImportLegacy } from '../lib/api';
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
  dataRoot: string;
  loaded: boolean;
  backendOnline: boolean;
  legacyAvailable: boolean;
  legacyPath: string;
  selectedProjectSlug: string | null;

  selectProject: (slug: string | null) => void;
  refresh: () => Promise<void>;
  addProject: (name: string, repoPath?: string | null) => Promise<ProjectMeta | null>;
  editProject: (
    slug: string,
    patch: { name?: string; repoPath?: string | null; glossary?: string[] }
  ) => Promise<ProjectMeta | null>;
  removeProject: (slug: string) => Promise<void>;
  addNote: (projectSlug?: string, title?: string) => Promise<NoteMeta | null>;
  renameNoteAt: (notePath: string, newTitle: string) => Promise<NoteMeta | null>;
  moveNoteTo: (notePath: string, targetProjectSlug: string) => Promise<NoteMeta | null>;
  removeNote: (notePath: string) => Promise<void>;
  importLegacy: () => Promise<{ importedProjects: number; importedNotes: number } | null>;
}

export const useNotesStore = create<NotesState>((set, get) => {
  const refreshInternal = async () => {
    try {
      const [{ dataRoot, projects }, health] = await Promise.all([
        loadProjects(),
        apiHealth().catch(() => null)
      ]);
      set((state) => ({
        projects,
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
    dataRoot: '',
    loaded: false,
    backendOnline: true,
    legacyAvailable: false,
    legacyPath: '',
    selectedProjectSlug: null,

    selectProject: (slug) => set({ selectedProjectSlug: slug }),

    refresh: () => enqueueNoteOp(refreshInternal),

    addProject: (name, repoPath) =>
      enqueueNoteOp(async () => {
        try {
          const created = await createProject(name, repoPath);
          await refreshInternal();
          set({ selectedProjectSlug: created.slug });
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
          set({ selectedProjectSlug: updated.slug });
        }
        await refreshInternal();
        return updated;
      }),

    removeProject: (slug) =>
      enqueueNoteOp(async () => {
        await deleteProject(slug);
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
