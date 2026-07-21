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

const mimeByExtension: Record<string, string> = Object.fromEntries(
  Object.entries(extensionsByMime).map(([mime, extension]) => [extension, mime])
);

function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000; // เลี่ยง call stack overflow ตอน spread array ยาวๆ (รูปหลาย MB)
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

const inlineImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const hasSchemeOrAbsolute = /^(?:[a-z][a-z+.-]*:|\/)/i;

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

/**
 * แปลงรูปที่ลิงก์แบบ relative (เก็บอยู่ในโฟลเดอร์ `.assets`) ให้เป็น base64 ฝังในตัวไฟล์ md เอง
 * ใช้ตอน export ไฟล์เดียวส่งให้คนอื่น — ไม่ต้องแนบโฟลเดอร์รูปไปด้วยแยกอีกไฟล์
 */
export async function inlineNoteImages(content: string, documentPath: string | null): Promise<string> {
  if (!hasTauri || !documentPath) return content;

  const relativePaths = Array.from(
    new Set(
      Array.from(content.matchAll(inlineImagePattern), (match) => match[2]).filter(
        (path) => !hasSchemeOrAbsolute.test(path)
      )
    )
  );
  if (!relativePaths.length) return content;

  const [{ dirname, join }, { readFile, exists }] = await Promise.all([tauriPath(), tauriFs()]);
  const directory = await dirname(documentPath);

  const dataUrls = new Map<string, string>();
  await Promise.all(
    relativePaths.map(async (relativePath) => {
      try {
        const absolutePath = await join(directory, decodeURIComponent(relativePath));
        if (!(await exists(absolutePath))) return;
        const bytes = await readFile(absolutePath);
        const extension = relativePath.match(/\.([a-z0-9]{1,8})(?:$|[?#])/i)?.[1]?.toLowerCase() ?? 'png';
        const mime = mimeByExtension[extension] ?? 'image/png';
        dataUrls.set(relativePath, `data:${mime};base64,${toBase64(bytes)}`);
      } catch {
        // อ่านรูปไม่ได้ (ถูกลบ/ย้ายไปแล้ว) — เก็บลิงก์เดิมไว้ ดีกว่าทำ export พังทั้งไฟล์
      }
    })
  );
  if (!dataUrls.size) return content;

  return content.replace(inlineImagePattern, (full, alt, path, title = '') => {
    const dataUrl = dataUrls.get(path);
    return dataUrl ? `![${alt}](${dataUrl}${title})` : full;
  });
}
