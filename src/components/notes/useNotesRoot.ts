import { useEffect, useState } from 'react';
import { defaultNotesRootDir, migrateNotesRoot, notesRootDir, notesSupported } from '../../lib/noteService';
import { pathSegments } from '../../lib/paths';
import { tauriDialog } from '../../lib/platform';
import { useDocStore } from '../../store/docStore';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';

// จัดการโฟลเดอร์หลักที่เก็บโน้ต: แสดง path ปัจจุบัน เปลี่ยนผ่าน dialog หรือกลับค่าเริ่มต้น
// (พร้อมตัวเลือกย้ายโน้ตเดิมทั้งหมดไปโฟลเดอร์ใหม่)
export function useNotesRoot() {
  const notesRoot = useSettingsStore((state) => state.notesRoot);
  const [rootDir, setRootDir] = useState('');

  useEffect(() => {
    if (!notesSupported) return;
    void notesRootDir().then(setRootDir);
  }, [notesRoot]);

  // เปลี่ยนโฟลเดอร์หลักที่เก็บโน้ต (target = null → กลับไปใช้ค่าเริ่มต้น Documents\PlainMark)
  const applyNotesRoot = async (target: string | null) => {
    const oldRoot = await notesRootDir();
    const newRoot = target ?? (await defaultNotesRootDir());
    if (newRoot !== oldRoot) {
      const migrate = window.confirm(
        `เปลี่ยนโฟลเดอร์เก็บโน้ตเป็น:\n${newRoot}\n\n` +
          'ต้องการย้ายโน้ตเดิมทั้งหมดไปโฟลเดอร์ใหม่ด้วยหรือไม่?\n' +
          '(Cancel = เปลี่ยนเฉพาะโฟลเดอร์ โน้ตเดิมยังอยู่ที่เดิม)'
      );
      useSettingsStore.getState().setNotesRoot(target);
      if (migrate) {
        const failures = await migrateNotesRoot(oldRoot, newRoot);
        const doc = useDocStore.getState();
        if (doc.notePath?.startsWith(oldRoot)) {
          const rel = doc.notePath.slice(oldRoot.length).replace(/^[\\/]+/, '');
          const groupName = pathSegments(rel)[0];
          if (!failures.includes(groupName)) {
            const movedPath = `${newRoot.replace(/[\\/]+$/, '')}\\${rel}`;
            doc.setNotePath(movedPath);
            doc.setFile({ path: movedPath, name: doc.file.name });
          }
        }
        if (failures.length > 0) {
          window.alert(`ย้ายบางกลุ่มไม่สำเร็จ: ${failures.join(', ')}\nกรุณาย้ายเองด้วย File Explorer`);
        }
      }
    } else {
      useSettingsStore.getState().setNotesRoot(target);
    }
    await useNotesStore.getState().refresh();
  };

  const changeRootViaDialog = async () => {
    const { open } = await tauriDialog();
    const picked = await open({ directory: true, title: 'เลือกโฟลเดอร์เก็บโน้ต', defaultPath: rootDir || undefined });
    if (typeof picked !== 'string' || !picked) return;
    await applyNotesRoot(picked);
  };

  return { rootDir, hasCustomRoot: notesRoot !== null, applyNotesRoot, changeRootViaDialog };
}
