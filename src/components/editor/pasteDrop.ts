// Paste Anything + ลากวางรูปลง editor — จัดการ event ระดับ DOM ของ editor host
// กติกาวาง: รูปจากคลิปบอร์ด → ฝัง base64, HTML จาก Word/Excel/เว็บ → แปลงเป็น Markdown,
// URL ยาวเดี่ยวๆ → ย่อเป็น reference-style
import { EditorView } from '@codemirror/view';
import { insertReferenceLink, longUrlThreshold } from '../../lib/formatActions';
import { embedImageAsset, embedImageReference, isImageFile, readImageAsDataUrl } from '../../lib/imagePaste';
import { saveImageAsset } from '../../lib/imageAssets';
import { convertClipboardHtml } from '../../lib/pasteConvert';

const imageUrlPattern = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?\S*)?$/i;

// ฝังรูปเป็น base64 reference-style ที่ตำแหน่ง cursor (ใช้ร่วมกันทั้ง paste และ drop)
async function insertImageFile(view: EditorView, file: File, documentPath: string | null): Promise<void> {
  const relativePath = await saveImageAsset(file, documentPath);
  const result = relativePath
    ? embedImageAsset(view.state.doc.toString(), view.state.selection.main.from, relativePath)
    : embedImageReference(view.state.doc.toString(), view.state.selection.main.from, await readImageAsDataUrl(file));
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.content },
    selection: { anchor: result.selectionStart },
    scrollIntoView: true
  });
}

// ผูก listener กับ editor host คืนฟังก์ชันถอด listener (ใช้เป็น cleanup ของ useEffect)
export function attachPasteDrop(
  root: HTMLElement,
  getView: () => EditorView | null,
  getDocumentPath: () => string | null
): () => void {
  const handlePaste = async (event: ClipboardEvent) => {
    const view = getView();
    if (!view) return;

    const item = Array.from(event.clipboardData?.items ?? []).find((clipboardItem) =>
      clipboardItem.type.startsWith('image/')
    );
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      await insertImageFile(view, file, getDocumentPath());
      return;
    }

    const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    const isBareUrl = /^https?:\/\/\S+$/.test(text);

    // Paste Anything: HTML จาก Word/Excel/เว็บ → แปลงเป็น Markdown (ตาราง Excel → Markdown Table)
    // ยกเว้น URL เปล่า — ให้ตกไปเข้ากติกาย่อลิงก์ด้านล่างแทน
    if (!isBareUrl) {
      const html = event.clipboardData?.getData('text/html');
      const markdownFromHtml = convertClipboardHtml(html);
      if (markdownFromHtml) {
        event.preventDefault();
        const selection = view.state.selection.main;
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: markdownFromHtml },
          selection: { anchor: selection.from + markdownFromHtml.length },
          scrollIntoView: true,
          userEvent: 'input.paste'
        });
        return;
      }
    }

    // วาง URL ยาวเดี่ยวๆ → ย่อเป็น reference-style อัตโนมัติ ไม่ให้รก editor
    if (isBareUrl && text.length > longUrlThreshold) {
      event.preventDefault();
      const selection = view.state.selection.main;
      const kind = imageUrlPattern.test(text) ? 'image' : 'link';
      const result = insertReferenceLink(
        view.state.doc.toString(),
        { from: selection.from, to: selection.to },
        text,
        kind
      );
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: result.content },
        selection: { anchor: result.selectionStart },
        scrollIntoView: true
      });
    }
  };

  const handleDragOver = (event: DragEvent) => {
    const hasImage = Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith('image/'));
    if (hasImage) {
      event.preventDefault();
      root.classList.add('is-dragging-image');
    }
  };

  const handleDragLeave = () => {
    root.classList.remove('is-dragging-image');
  };

  const handleDrop = async (event: DragEvent) => {
    root.classList.remove('is-dragging-image');
    const file = Array.from(event.dataTransfer?.files ?? []).find(isImageFile);
    const view = getView();
    if (!file || !view) return;
    event.preventDefault();
    await insertImageFile(view, file, getDocumentPath());
  };

  root.addEventListener('paste', handlePaste);
  root.addEventListener('dragover', handleDragOver);
  root.addEventListener('dragleave', handleDragLeave);
  root.addEventListener('drop', handleDrop);

  return () => {
    root.removeEventListener('paste', handlePaste);
    root.removeEventListener('dragover', handleDragOver);
    root.removeEventListener('dragleave', handleDragLeave);
    root.removeEventListener('drop', handleDrop);
  };
}
