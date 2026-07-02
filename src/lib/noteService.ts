export interface NoteMeta {
  name: string; // ชื่อโน้ต (ไม่มีนามสกุล .md)
  path: string;
  modifiedAt: number;
}

export interface GroupMeta {
  name: string;
  path: string;
  notes: NoteMeta[];
}

export const notesSupported = '__TAURI_INTERNALS__' in window;

const noteExtension = '.md';
const rootFolderName = 'PlainMark';

async function fsApi() {
  const [path, fs] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs')
  ]);
  return { path, fs };
}

export async function notesRootDir(): Promise<string> {
  const { path } = await fsApi();
  return path.join(await path.documentDir(), rootFolderName);
}

export async function ensureNotesRoot(): Promise<string> {
  const { fs } = await fsApi();
  const root = await notesRootDir();
  await fs.mkdir(root, { recursive: true });
  return root;
}

export function todayGroupName(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ตัดอักขระต้องห้ามของชื่อไฟล์ Windows และช่องว่าง/จุดหัวท้าย
export function sanitizeName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .trim();
  return cleaned || fallback;
}

async function uniquePath(dir: string, baseName: string, extension: string): Promise<string> {
  const { path, fs } = await fsApi();
  let candidate = await path.join(dir, `${baseName}${extension}`);
  let counter = 2;
  while (await fs.exists(candidate)) {
    candidate = await path.join(dir, `${baseName} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
}

export async function loadTree(): Promise<GroupMeta[]> {
  const { path, fs } = await fsApi();
  const root = await ensureNotesRoot();
  const rootEntries = await fs.readDir(root);
  const groups: GroupMeta[] = [];

  for (const entry of rootEntries) {
    if (!entry.isDirectory) continue;
    const groupPath = await path.join(root, entry.name);
    const noteEntries = await fs.readDir(groupPath);
    const notes: NoteMeta[] = [];

    for (const noteEntry of noteEntries) {
      if (!noteEntry.isFile || !noteEntry.name.toLowerCase().endsWith(noteExtension)) continue;
      const notePath = await path.join(groupPath, noteEntry.name);
      let modifiedAt = 0;
      try {
        const info = await fs.stat(notePath);
        modifiedAt = info.mtime ? new Date(info.mtime).getTime() : 0;
      } catch {
        // stat พลาดไม่ใช่เรื่องใหญ่ — แค่เรียงลำดับหยาบลง
      }
      notes.push({ name: noteEntry.name.slice(0, -noteExtension.length), path: notePath, modifiedAt });
    }

    notes.sort((a, b) => b.modifiedAt - a.modifiedAt);
    groups.push({ name: entry.name, path: groupPath, notes });
  }

  // กลุ่มชื่อวันที่ล่าสุดขึ้นก่อน ตามด้วยกลุ่มชื่ออื่นเรียงตามตัวอักษร
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  groups.sort((a, b) => {
    const aIsDate = datePattern.test(a.name);
    const bIsDate = datePattern.test(b.name);
    if (aIsDate && bIsDate) return b.name.localeCompare(a.name);
    if (aIsDate) return -1;
    if (bIsDate) return 1;
    return a.name.localeCompare(b.name, 'th');
  });
  return groups;
}

export async function createGroup(name: string): Promise<string> {
  const { path, fs } = await fsApi();
  const root = await ensureNotesRoot();
  const groupPath = await path.join(root, sanitizeName(name, 'กลุ่มใหม่'));
  await fs.mkdir(groupPath, { recursive: true });
  return groupPath;
}

export async function createNote(groupName?: string, title?: string): Promise<NoteMeta> {
  const { fs } = await fsApi();
  const groupPath = await createGroup(groupName ?? todayGroupName());
  const baseName = sanitizeName(title ?? 'โน้ตใหม่', 'โน้ตใหม่');
  const notePath = await uniquePath(groupPath, baseName, noteExtension);
  await fs.writeTextFile(notePath, '');
  return {
    name: notePath.split(/[\\/]/).pop()!.slice(0, -noteExtension.length),
    path: notePath,
    modifiedAt: Date.now()
  };
}

export async function readNote(notePath: string): Promise<string> {
  const { fs } = await fsApi();
  return fs.readTextFile(notePath);
}

// เขียนโน้ตแบบเรียงคิว latest-wins ต่อไฟล์ ให้ flushNoteWrites() await ได้ตอนปิดแอป
const noteWriteChains = new Map<string, Promise<void>>();
const notePending = new Map<string, string>();

export function writeNoteQueued(notePath: string, content: string): Promise<void> {
  notePending.set(notePath, content);
  const chain = (noteWriteChains.get(notePath) ?? Promise.resolve())
    .then(async () => {
      const snapshot = notePending.get(notePath);
      if (snapshot === undefined) return;
      notePending.delete(notePath);
      const { fs } = await fsApi();
      await fs.writeTextFile(notePath, snapshot);
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

export async function renameNote(notePath: string, newTitle: string): Promise<NoteMeta> {
  const { path, fs } = await fsApi();
  const dir = await path.dirname(notePath);
  const currentName = notePath.split(/[\\/]/).pop()!.slice(0, -noteExtension.length);
  const nextName = sanitizeName(newTitle, 'untitled');
  if (nextName === currentName) {
    return { name: currentName, path: notePath, modifiedAt: Date.now() };
  }
  const target = await uniquePath(dir, nextName, noteExtension);
  await flushNoteWrites();
  await fs.rename(notePath, target);
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  return {
    name: target.split(/[\\/]/).pop()!.slice(0, -noteExtension.length),
    path: target,
    modifiedAt: Date.now()
  };
}

export async function renameGroup(groupPath: string, newName: string): Promise<string> {
  const { path, fs } = await fsApi();
  const root = await notesRootDir();
  const target = await path.join(root, sanitizeName(newName, 'กลุ่มใหม่'));
  if (target === groupPath) return groupPath;
  if (await fs.exists(target)) throw new Error('มีกลุ่มชื่อนี้อยู่แล้ว');
  await flushNoteWrites();
  await fs.rename(groupPath, target);
  return target;
}

export async function moveNote(notePath: string, targetGroupName: string): Promise<NoteMeta> {
  const { fs } = await fsApi();
  const groupPath = await createGroup(targetGroupName);
  const fileName = notePath.split(/[\\/]/).pop()!;
  const baseName = fileName.slice(0, -noteExtension.length);
  const target = await uniquePath(groupPath, baseName, noteExtension);
  await flushNoteWrites();
  await fs.rename(notePath, target);
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  return { name: baseName, path: target, modifiedAt: Date.now() };
}

export async function deleteNote(notePath: string): Promise<void> {
  const { fs } = await fsApi();
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  await fs.remove(notePath);
}

export async function deleteGroup(groupPath: string): Promise<void> {
  const { fs } = await fsApi();
  await fs.remove(groupPath, { recursive: true });
}
