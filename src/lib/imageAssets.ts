import { hasTauri, tauriFs, tauriPath } from './platform';

const extensionsByMime: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

function fileExtension(file: File): string {
  const fromName = file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  return fromName ?? extensionsByMime[file.type] ?? 'png';
}

function noteStem(fileName: string): string {
  return fileName.replace(/\.(md|markdown|txt)$/i, '') || 'note';
}

/**
 * บันทึกรูปไว้ข้างไฟล์ Markdown แล้วคืน path relative สั้นๆ ที่พกพาได้
 * โน้ต 1 ไฟล์กับโฟลเดอร์ `.assets` ของมันจะถูกก็อป/อัปโหลดไปด้วยกันได้ทั้งชุด
 */
export async function saveImageAsset(file: File, documentPath: string | null): Promise<string | null> {
  if (!hasTauri || !documentPath) return null;

  const [{ dirname, basename, join }, { mkdir, writeFile }] = await Promise.all([tauriPath(), tauriFs()]);
  const directory = await dirname(documentPath);
  const documentName = await basename(documentPath);
  const assetsName = `${noteStem(documentName)}.assets`;
  const assetsDirectory = await join(directory, assetsName);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const imageName = `image-${id}.${fileExtension(file)}`;

  await mkdir(assetsDirectory, { recursive: true });
  await writeFile(await join(assetsDirectory, imageName), new Uint8Array(await file.arrayBuffer()));
  return `${assetsName}/${imageName}`;
}
