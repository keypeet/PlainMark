import { useEffect, useRef } from 'react';
import { flushNoteWrites, writeNoteQueued } from '../lib/noteService';
import { hasTauri, tauriWindow } from '../lib/platform';
import { flushSession, loadSession, saveSession } from '../lib/session';
import { useDocStore } from '../store/docStore';

// รวบรวมสถานะปัจจุบันแล้วบันทึก session + เนื้อหาโน้ต (ถ้าเปิดโน้ตอยู่)
function persistNow(): Promise<void> {
  const { content, file, notePath, dirty } = useDocStore.getState();
  const tasks: Promise<void>[] = [
    saveSession({
      content,
      filePath: file.path,
      fileName: file.name,
      notePath,
      dirty,
      updatedAt: Date.now()
    })
  ];
  if (notePath) tasks.push(writeNoteQueued(notePath, content));
  return Promise.all(tasks).then(() => undefined);
}

// วงจร "งานไม่มีวันหาย": กู้คืน session ตอนเปิดแอป → autosave ทุกจังหวะที่เอกสารเปลี่ยน
// → flush ทุกคิวก่อนหน้าต่างปิดจริง
export function useSessionPersistence() {
  const sessionReady = useRef(false);
  const content = useDocStore((state) => state.content);
  const filePath = useDocStore((state) => state.file.path);
  const fileName = useDocStore((state) => state.file.name);
  const notePath = useDocStore((state) => state.notePath);
  const dirty = useDocStore((state) => state.dirty);

  // กู้คืน session เงียบๆ ตอนเปิดแอป (แบบ Notepad — ไม่ถาม ไม่มีทางหาย)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadSession();
        if (!cancelled && session && !useDocStore.getState().dirty) {
          useDocStore.getState().hydrate({
            content: session.content,
            filePath: session.filePath,
            fileName: session.fileName,
            notePath: session.notePath,
            dirty: session.dirty
          });
        }
      } finally {
        sessionReady.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // บันทึกออโต้เสมอ (ไม่สนว่า dirty หรือไม่) — คงสภาพล่าสุดไว้ให้เปิดกลับมาเหมือนเดิม
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sessionReady.current) return;
      void persistNow().then(() => {
        const state = useDocStore.getState();
        if (state.notePath && state.content === content) state.markSaved(content);
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [content, filePath, fileName, notePath, dirty]);

  // flush ก่อนหน้าต่างปิดจริง — หัวใจของ "กด X แล้วงานไม่หาย"
  useEffect(() => {
    if (!hasTauri) return;
    let unlisten: (() => void) | undefined;
    let closing = false;
    (async () => {
      const { getCurrentWindow } = await tauriWindow();
      const win = getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event) => {
        if (closing) return;
        closing = true;
        event.preventDefault();
        try {
          await Promise.race([
            persistNow().then(() => Promise.all([flushSession(), flushNoteWrites()])),
            new Promise((resolve) => setTimeout(resolve, 3000))
          ]);
        } finally {
          await win.destroy();
        }
      });
    })();
    return () => unlisten?.();
  }, []);
}
