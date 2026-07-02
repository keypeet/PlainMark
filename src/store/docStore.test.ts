import { beforeEach, describe, expect, it } from 'vitest';
import { useDocStore } from './docStore';

describe('docStore.hydrate', () => {
  beforeEach(() => {
    useDocStore.getState().newDocument();
  });

  it('restores a dirty session and keeps dirty=true after identical setContent', () => {
    useDocStore.getState().hydrate({
      content: 'unsaved work',
      filePath: null,
      fileName: 'untitled.md',
      notePath: null,
      dirty: true
    });
    expect(useDocStore.getState().dirty).toBe(true);

    // การพิมพ์ที่ได้ content เท่าเดิมต้องไม่ล้างสถานะ dirty
    useDocStore.getState().setContent('unsaved work');
    expect(useDocStore.getState().dirty).toBe(true);
  });

  it('restores a clean session as not dirty', () => {
    useDocStore.getState().hydrate({
      content: 'saved doc',
      filePath: 'C:\\docs\\a.md',
      fileName: 'a.md',
      notePath: null,
      dirty: false
    });
    const state = useDocStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.lastSavedContent).toBe('saved doc');
    expect(state.file).toEqual({ path: 'C:\\docs\\a.md', name: 'a.md' });
  });

  it('restores notePath', () => {
    useDocStore.getState().hydrate({
      content: 'note body',
      filePath: 'C:\\Documents\\PlainMark\\2026-07-02\\โน้ตใหม่.md',
      fileName: 'โน้ตใหม่.md',
      notePath: 'C:\\Documents\\PlainMark\\2026-07-02\\โน้ตใหม่.md',
      dirty: false
    });
    expect(useDocStore.getState().notePath).toBe('C:\\Documents\\PlainMark\\2026-07-02\\โน้ตใหม่.md');
  });

  it('newDocument clears notePath', () => {
    useDocStore.getState().setNotePath('C:\\Documents\\PlainMark\\x\\y.md');
    useDocStore.getState().newDocument();
    expect(useDocStore.getState().notePath).toBeNull();
  });
});
