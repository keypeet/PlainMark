import { useEffect, useRef } from 'react';
import { flushNoteWrites, readNote, writeNoteQueued } from '../lib/noteService';
import { flushSession, loadSession, saveSession } from '../lib/session';
import { useDocStore } from '../store/docStore';

let lastSessionFingerprint = '';

function serializeContentForSave(content: string, lineEnding: 'LF' | 'CRLF'): string {
  return lineEnding === 'CRLF' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
}

function buildSessionPayload() {
  const { tabs, activeTabId } = useDocStore.getState();
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      notePath: tab.notePath,
      projectSlug: tab.projectSlug,
      // สำหรับแท็บที่ผูกกับไฟล์โน้ตจริงและบันทึกแล้ว ไม่ต้องอัดเนื้อหาซ้ำใน session.json ให้หนัก
      content: tab.notePath && !tab.dirty ? '' : tab.content,
      dirty: tab.dirty,
      lineEnding: tab.lineEnding
    })),
    activeTabId,
    updatedAt: Date.now()
  };
}

export async function persistActiveAndSession(): Promise<void> {
  const state = useDocStore.getState();
  const payload = buildSessionPayload();
  const fingerprint = JSON.stringify({ tabs: payload.tabs, activeTabId: payload.activeTabId });

  const tasks: Promise<void>[] = [];
  for (const tab of state.tabs) {
    if (tab.notePath && tab.dirty) {
      const textToWrite = serializeContentForSave(tab.content, tab.lineEnding);
      const tabId = tab.id;
      const savedContent = tab.content;
      tasks.push(
        writeNoteQueued(tab.notePath, textToWrite).then(() => {
          const latest = useDocStore.getState().tabs.find((t) => t.id === tabId);
          if (latest && latest.content === savedContent) {
            useDocStore.getState().markTabSaved(tabId, savedContent);
          }
        })
      );
    }
  }

  if (fingerprint !== lastSessionFingerprint) {
    lastSessionFingerprint = fingerprint;
    tasks.push(saveSession(payload));
  }

  await Promise.all(tasks);
}

// วงจร "งานไม่มีวันหาย": กู้คืนแท็บทั้งหมดตอนเปิดแอป → autosave ทุกจังหวะ → flush ก่อนปิดหน้าต่าง
export function useSessionPersistence() {
  const sessionReady = useRef(false);
  const tabs = useDocStore((state) => state.tabs);
  const activeTabId = useDocStore((state) => state.activeTabId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await loadSession();
        if (cancelled || !session) return;

        if (Array.isArray(session.tabs) && session.tabs.length > 0) {
          const restored = await Promise.all(
            session.tabs.map(async (item) => {
              if (!item.notePath) return item;
              if (item.dirty && item.content) return item;
              try {
                const diskContent = await readNote(item.notePath);
                return { ...item, content: diskContent, dirty: false };
              } catch {
                // ไฟล์ถูกลบจากภายนอกไปแล้ว → ข้ามแท็บนี้
                return null;
              }
            })
          );
          const valid = restored.filter((item): item is NonNullable<typeof item> => item !== null);
          if (!cancelled && valid.length > 0) {
            useDocStore.getState().hydrateTabs({ tabs: valid, activeTabId: session.activeTabId ?? valid[0].id });
          }
        } else if (typeof session.content === 'string') {
          useDocStore.getState().hydrate({
            content: session.content,
            filePath: session.filePath ?? null,
            fileName: session.fileName ?? 'Untitled.md',
            notePath: session.notePath ?? null,
            dirty: session.dirty === true
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sessionReady.current) return;
      void persistActiveAndSession();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [tabs, activeTabId]);

  useEffect(() => {
    const onUnload = () => {
      // ส่ง session + dirty note ด้วย sendBeacon / keepalive ก่อนปิดแท็บ/หน้าต่าง Edge
      const payload = buildSessionPayload();
      try {
        localStorage.setItem('plainmark:session:v2', JSON.stringify(payload));
      } catch {
        // ignore
      }
      const { tabs: currentTabs } = useDocStore.getState();
      for (const tab of currentTabs) {
        if (tab.notePath && tab.dirty) {
          const body = JSON.stringify({
            path: tab.notePath,
            content: serializeContentForSave(tab.content, tab.lineEnding),
            mustExist: true
          });
          void fetch('/api/notes/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true
          });
        }
      }
      void fetch('/api/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });
      void flushSession();
      void flushNoteWrites();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);
}
