import { apiInlineImages, apiUploadAsset } from './api';

export async function saveImageAsset(file: File, documentPath: string | null): Promise<string | null> {
  if (!documentPath) return null;
  try {
    return await apiUploadAsset(documentPath, file);
  } catch (error) {
    console.error('PlainMark: upload image asset failed', error);
    return null;
  }
}

export async function inlineNoteImages(content: string, documentPath: string | null): Promise<string> {
  if (!documentPath) return content;
  try {
    const res = await apiInlineImages(documentPath, content);
    return res.content;
  } catch (error) {
    console.error('PlainMark: inline images failed', error);
    return content;
  }
}
