import {
  apiCreateNote,
  apiCreateProject,
  apiDeleteNote,
  apiDeleteProject,
  apiListHistory,
  apiListProjects,
  apiMoveNote,
  apiReadHistory,
  apiReadNote,
  apiRenameNote,
  apiSaveHistory,
  apiUpdateProject,
  apiWriteNote
} from './api';
import type { NoteMeta, ProjectMeta, SnapshotMeta } from './api';
import { baseName, pathSegments } from './paths';
import { useSettingsStore } from '../store/settingsStore';

export type { NoteMeta, ProjectMeta, SnapshotMeta };

export const notesSupported = true;
export const noteExtension = '.md';

// ดึงชื่อโปรเจคจาก path: รองรับทั้งรูปแบบใหม่ (projects/<slug>/notes/<file>.md) และ path เก่า (<root>/<group>/<file>.md)
export function noteGroupName(notePath: string): string | null {
  const segments = pathSegments(notePath);
  if (segments.length >= 4 && segments[0] === 'projects' && segments[2] === 'notes') {
    return segments[1];
  }
  return segments.length >= 2 ? segments[segments.length - 2] : null;
}

export function noteNameFromPath(notePath: string): string {
  const name = baseName(notePath);
  return name.toLowerCase().endsWith(noteExtension) ? name.slice(0, -noteExtension.length) : name;
}

export function todayGroupName(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sanitizeName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .trim();
  return cleaned || fallback;
}

// คิวกลางงานโครงสร้างโน้ต/โปรเจค — บังคับทำทีละงานเรียงคิว กัน race condition
let noteOpChain: Promise<unknown> = Promise.resolve();
export function enqueueNoteOp<T>(op: () => Promise<T>): Promise<T> {
  const run = noteOpChain.then(op, op);
  noteOpChain = run.catch(() => {});
  return run;
}

// เขียนโน้ตแบบเรียงคิว latest-wins ต่อไฟล์ ให้ flushNoteWrites() await ได้ก่อนสลับ/ปิด
const noteWriteChains = new Map<string, Promise<void>>();
const notePending = new Map<string, string>();

export function writeNoteQueued(notePath: string, content: string): Promise<void> {
  notePending.set(notePath, content);
  const chain = (noteWriteChains.get(notePath) ?? Promise.resolve())
    .then(async () => {
      const snapshot = notePending.get(notePath);
      if (snapshot === undefined) return;
      notePending.delete(notePath);
      const { historyIntervalMin, historyKeep } = useSettingsStore.getState();
      await apiWriteNote(notePath, snapshot, {
        mustExist: true,
        historyIntervalMin,
        historyKeep
      });
    })
    .catch((error) => {
      console.error('PlainMark: note save failed', error);
    });
  noteWriteChains.set(notePath, chain);
  return chain;
}

export function flushNoteWrites(): Promise<void> {
  return Promise.all([...noteWriteChains.values()]).then(() => undefined);
}

export async function loadProjects(): Promise<{ dataRoot: string; projects: ProjectMeta[] }> {
  return apiListProjects();
}

export async function createProject(name: string, repoPath?: string | null): Promise<ProjectMeta> {
  return apiCreateProject(name, repoPath);
}

export async function updateProject(
  slug: string,
  patch: { name?: string; repoPath?: string | null; glossary?: string[] }
): Promise<ProjectMeta> {
  await flushNoteWrites();
  return apiUpdateProject(slug, patch);
}

export async function deleteProject(slug: string): Promise<void> {
  await flushNoteWrites();
  await apiDeleteProject(slug);
}

export async function createNote(projectSlug?: string, title?: string): Promise<NoteMeta> {
  return apiCreateNote(projectSlug, title);
}

export async function readNote(notePath: string): Promise<string> {
  const res = await apiReadNote(notePath);
  return res.content;
}

export async function renameNote(notePath: string, newTitle: string): Promise<NoteMeta> {
  await flushNoteWrites();
  const renamed = await apiRenameNote(notePath, newTitle);
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  return renamed;
}

export async function moveNote(notePath: string, targetProjectSlug: string): Promise<NoteMeta> {
  await flushNoteWrites();
  const moved = await apiMoveNote(notePath, targetProjectSlug);
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  return moved;
}

export async function deleteNote(notePath: string): Promise<void> {
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  await apiDeleteNote(notePath);
}

export async function listSnapshots(notePath: string): Promise<SnapshotMeta[]> {
  const res = await apiListHistory(notePath);
  return res.snapshots;
}

export async function readSnapshot(snapshotPath: string): Promise<string> {
  const res = await apiReadHistory(snapshotPath);
  return res.content;
}

export async function saveSnapshot(notePath: string, content: string): Promise<void> {
  const { historyKeep } = useSettingsStore.getState();
  await apiSaveHistory(notePath, content, historyKeep);
}
