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

import { useSettingsStore } from '../store/settingsStore';
import { pad2 } from './dateFormat';
import { hasTauri, tauriFs, tauriPath } from './platform';
import { baseName, pathSegments } from './paths';

export const notesSupported = hasTauri;

export const noteExtension = '.md';
const rootFolderName = 'PlainMark';

async function fsApi() {
  const [path, fs] = await Promise.all([tauriPath(), tauriFs()]);
  return { path, fs };
}

export async function defaultNotesRootDir(): Promise<string> {
  const { path } = await fsApi();
  return path.join(await path.documentDir(), rootFolderName);
}

// root ที่ใช้จริง — ผู้ใช้เลือกเองได้ในตั้งค่า ไม่เลือกก็ใช้ Documents\PlainMark
export async function notesRootDir(): Promise<string> {
  const custom = useSettingsStore.getState().notesRoot;
  return custom ?? defaultNotesRootDir();
}

export async function ensureNotesRoot(): Promise<string> {
  const { fs } = await fsApi();
  const root = await notesRootDir();
  await fs.mkdir(root, { recursive: true });
  return root;
}

// ชื่อกลุ่มของโน้ต = ชื่อโฟลเดอร์แม่ของไฟล์ (โครงสร้าง root\กลุ่ม\ชื่อโน้ต.md)
export function noteGroupName(notePath: string): string | null {
  const segments = pathSegments(notePath);
  return segments.length >= 2 ? segments[segments.length - 2] : null;
}

// ชื่อโน้ต = ชื่อไฟล์ตัด .md ออก
export function noteNameFromPath(notePath: string): string {
  return baseName(notePath).slice(0, -noteExtension.length);
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
  const baseName = sanitizeName(title ?? 'new note', 'new note');
  const notePath = await uniquePath(groupPath, baseName, noteExtension);
  await fs.writeTextFile(notePath, '');
  return { name: noteNameFromPath(notePath), path: notePath, modifiedAt: Date.now() };
}

export async function readNote(notePath: string): Promise<string> {
  const { fs } = await fsApi();
  return fs.readTextFile(notePath);
}

// ---------- ประวัติเวอร์ชัน (snapshot) ----------
// เก็บสำเนาโน้ตเป็นระยะไว้ที่ <กลุ่ม>\.history\<ชื่อโน้ต>\<เวลา>.md
// เผื่อผู้ใช้อยากรีเซตทั้งโน้ตกลับเป็นเวอร์ชันเก่า (คนละชั้นกับ Ctrl+Z ที่เป็น undo ใน session)

export interface SnapshotMeta {
  path: string;
  savedAt: number; // epoch ms — แปลงจากชื่อไฟล์ ไม่ต้อง stat
}

const historyDirName = '.history';
// รอบเวลา/จำนวนที่เก็บ ปรับได้ในแผงประวัติ — อ่านสดจาก settings ทุกครั้งเพื่อให้ค่าที่แก้มีผลทันที
const snapshotKeep = () => useSettingsStore.getState().historyKeep;
const snapshotIntervalMs = () => useSettingsStore.getState().historyIntervalMin * 60 * 1000;
const lastSnapshotAt = new Map<string, number>();

async function noteHistoryDir(notePath: string): Promise<string> {
  const { path } = await fsApi();
  return path.join(await path.dirname(notePath), historyDirName, noteNameFromPath(notePath));
}

// ชื่อไฟล์ snapshot = เวลาที่เก็บ (อ่านง่ายเวลาเปิดดูใน File Explorer และ parse กลับได้)
function snapshotFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  return `${date} ${time}${noteExtension}`;
}

function snapshotTimeFromName(fileName: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})\.md$/.exec(fileName);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

export async function listSnapshots(notePath: string): Promise<SnapshotMeta[]> {
  const { path, fs } = await fsApi();
  const dir = await noteHistoryDir(notePath);
  if (!(await fs.exists(dir))) return [];
  const snapshots: SnapshotMeta[] = [];
  for (const entry of await fs.readDir(dir)) {
    if (!entry.isFile) continue;
    const savedAt = snapshotTimeFromName(entry.name);
    if (savedAt === null) continue;
    snapshots.push({ path: await path.join(dir, entry.name), savedAt });
  }
  return snapshots.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readSnapshot(snapshotPath: string): Promise<string> {
  const { fs } = await fsApi();
  return fs.readTextFile(snapshotPath);
}

// เก็บ snapshot ทันที (ใช้ก่อนกู้คืนเวอร์ชัน และจากรอบ autosave) แล้วตัดของเก่าเกินโควตา
export async function saveSnapshot(notePath: string, content: string): Promise<void> {
  if (!content.trim()) return; // เนื้อหาว่างไม่มีค่าพอให้เก็บ
  const { path, fs } = await fsApi();
  const dir = await noteHistoryDir(notePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeTextFile(await path.join(dir, snapshotFileName(new Date())), content);
  lastSnapshotAt.set(notePath, Date.now());
  for (const stale of (await listSnapshots(notePath)).slice(snapshotKeep())) {
    try {
      await fs.remove(stale.path);
    } catch {
      // ลบไม่ได้ก็แค่ค้างไว้ รอบหน้าลองใหม่
    }
  }
}

// เรียกก่อน autosave ทับไฟล์: ถึงรอบเวลาแล้วค่อยเก็บของเดิมบนดิสก์เข้าประวัติ (กัน snapshot ถี่เกิน)
async function maybeSnapshotBeforeWrite(notePath: string): Promise<void> {
  const last = lastSnapshotAt.get(notePath) ?? 0;
  if (Date.now() - last < snapshotIntervalMs()) return;
  lastSnapshotAt.set(notePath, Date.now()); // กันรีเช็คถี่แม้อ่านไฟล์พลาด
  try {
    const { fs } = await fsApi();
    const current = await fs.readTextFile(notePath);
    if (!current.trim()) return;
    const [newest] = await listSnapshots(notePath);
    if (newest && (await readSnapshot(newest.path)) === current) return; // ไม่ต่างจากล่าสุด — ไม่เก็บซ้ำ
    await saveSnapshot(notePath, current);
  } catch (error) {
    console.error('PlainMark: snapshot failed', error);
  }
}

// โฟลเดอร์ประวัติผูกกับชื่อ/ที่อยู่โน้ต — ย้ายตามเมื่อเปลี่ยนชื่อหรือย้ายกลุ่ม (พลาดได้ไม่ถือว่า fatal)
async function relocateNoteHistory(
  path: Awaited<ReturnType<typeof fsApi>>['path'],
  fs: Awaited<ReturnType<typeof fsApi>>['fs'],
  sourceNotePath: string,
  targetNotePath: string,
  oldNoteName: string,
  nextNoteName: string
): Promise<void> {
  try {
    const oldDir = await path.join(await path.dirname(sourceNotePath), historyDirName, oldNoteName);
    const nextParent = await path.join(await path.dirname(targetNotePath), historyDirName);
    const nextDir = await path.join(nextParent, nextNoteName);
    if (oldDir === nextDir || !(await fs.exists(oldDir)) || (await fs.exists(nextDir))) return;
    await fs.mkdir(nextParent, { recursive: true });
    await fs.rename(oldDir, nextDir);
    lastSnapshotAt.delete(sourceNotePath);
  } catch (error) {
    console.error('PlainMark: move history failed', error);
  }
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
      await maybeSnapshotBeforeWrite(notePath); // เก็บของเดิมบนดิสก์เข้าประวัติตามรอบเวลา ก่อนถูกทับ
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
  const currentName = noteNameFromPath(notePath);
  const nextName = sanitizeName(newTitle, 'untitled');
  if (nextName === currentName) {
    return { name: currentName, path: notePath, modifiedAt: Date.now() };
  }
  const target = await uniquePath(dir, nextName, noteExtension);
  await flushNoteWrites();
  await fs.rename(notePath, target);
  await relocateNoteAssets(path, fs, notePath, target, currentName, noteNameFromPath(target));
  await relocateNoteHistory(path, fs, notePath, target, currentName, noteNameFromPath(target));
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  return { name: noteNameFromPath(target), path: target, modifiedAt: Date.now() };
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
  const { path, fs } = await fsApi();
  const groupPath = await createGroup(targetGroupName);
  const noteName = noteNameFromPath(notePath);
  const target = await uniquePath(groupPath, noteName, noteExtension);
  await flushNoteWrites();
  await fs.rename(notePath, target);
  await relocateNoteAssets(path, fs, notePath, target, noteName, noteNameFromPath(target));
  await relocateNoteHistory(path, fs, notePath, target, noteName, noteNameFromPath(target));
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  return { name: noteName, path: target, modifiedAt: Date.now() };
}

// โฟลเดอร์รูปมีชื่อสัมพันธ์กับชื่อโน้ต จึงต้องย้ายและแก้ลิงก์ใน Markdown ทุกครั้งที่ชื่อ/กลุ่มเปลี่ยน
async function relocateNoteAssets(
  path: Awaited<ReturnType<typeof fsApi>>['path'],
  fs: Awaited<ReturnType<typeof fsApi>>['fs'],
  sourceNotePath: string,
  targetNotePath: string,
  oldNoteName: string,
  nextNoteName: string
): Promise<void> {
  const oldAssetsName = `${oldNoteName}.assets`;
  const nextAssetsName = `${nextNoteName}.assets`;
  if (oldAssetsName === nextAssetsName && sourceNotePath === targetNotePath) return;

  const sourceDir = await path.dirname(sourceNotePath);
  const targetDir = await path.dirname(targetNotePath);
  const oldAssets = await path.join(sourceDir, oldAssetsName);
  const nextAssets = await path.join(targetDir, nextAssetsName);
  if (!(await fs.exists(oldAssets))) return;
  if (await fs.exists(nextAssets)) throw new Error(`พบโฟลเดอร์รูปปลายทางอยู่แล้ว: ${nextAssetsName}`);

  await fs.rename(oldAssets, nextAssets);
  const content = await fs.readTextFile(targetNotePath);
  const nextContent = content
    .split(encodeURIComponent(oldAssetsName))
    .join(encodeURIComponent(nextAssetsName))
    .split(oldAssetsName)
    .join(nextAssetsName);
  if (nextContent !== content) await fs.writeTextFile(targetNotePath, nextContent);
}

export async function deleteNote(notePath: string): Promise<void> {
  const { fs } = await fsApi();
  noteWriteChains.delete(notePath);
  notePending.delete(notePath);
  lastSnapshotAt.delete(notePath);
  // จงใจไม่ลบโฟลเดอร์ .history — เผื่อกู้เนื้อหาโน้ตที่เผลอลบ (แบบเดียวกับ .assets ที่คงไว้)
  await fs.remove(notePath);
}

export async function deleteGroup(groupPath: string): Promise<void> {
  const { fs } = await fsApi();
  await fs.remove(groupPath, { recursive: true });
}

// ย้ายโฟลเดอร์กลุ่มทั้งหมดจาก root เดิมไป root ใหม่ คืนรายชื่อกลุ่มที่ย้ายไม่สำเร็จ
// (rename ข้ามไดรฟ์อาจล้มเหลว — ผู้ใช้ต้องย้ายเองด้วย File Explorer)
export async function migrateNotesRoot(oldRoot: string, newRoot: string): Promise<string[]> {
  const { path, fs } = await fsApi();
  const failures: string[] = [];
  if (oldRoot === newRoot || !(await fs.exists(oldRoot))) return failures;
  await fs.mkdir(newRoot, { recursive: true });
  await flushNoteWrites();
  for (const entry of await fs.readDir(oldRoot)) {
    if (!entry.isDirectory) continue;
    try {
      const from = await path.join(oldRoot, entry.name);
      const to = await path.join(newRoot, entry.name);
      if (await fs.exists(to)) throw new Error('duplicate');
      await fs.rename(from, to);
    } catch {
      failures.push(entry.name);
    }
  }
  return failures;
}
