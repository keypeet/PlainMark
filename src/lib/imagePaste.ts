import type { FormatResult } from '../types';

function nextImageId(content: string): string {
  const ids = Array.from(content.matchAll(/^\[img(\d+)\]:/gm), (match) => Number(match[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `img${next}`;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Cannot read image file.'));
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unsupported image data.'));
    };
    reader.readAsDataURL(file);
  });
}

export function embedImageReference(content: string, cursor: number, dataUrl: string): FormatResult {
  const id = nextImageId(content);
  const imageMarkdown = `![วางรูปภาพ][${id}]\n`;
  const reference = `\n[${id}]: ${dataUrl}\n`;
  const contentWithImage = content.slice(0, cursor) + imageMarkdown + content.slice(cursor);
  const nextContent = `${contentWithImage.trimEnd()}${reference}`;
  const nextCursor = cursor + imageMarkdown.length;

  return { content: nextContent, selectionStart: nextCursor, selectionEnd: nextCursor };
}
