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

  it('supports multi-tab open, switch, rename sync, and close', () => {
    const store = useDocStore.getState();
    store.openNoteTab({ path: 'projects/Inbox/notes/a.md', name: 'a', projectSlug: 'Inbox' }, 'AAA');
    store.openNoteTab({ path: 'projects/Work/notes/b.md', name: 'b', projectSlug: 'Work' }, 'BBB');
    expect(useDocStore.getState().tabs).toHaveLength(2);
    expect(useDocStore.getState().content).toBe('BBB');

    // Reopening already-open note activates existing tab without duplicating
    useDocStore.getState().openNoteTab({ path: 'projects/Inbox/notes/a.md', name: 'a', projectSlug: 'Inbox' }, 'AAA');
    expect(useDocStore.getState().tabs).toHaveLength(2);
    expect(useDocStore.getState().content).toBe('AAA');

    // Sync rename updates tab path & title
    useDocStore.getState().syncNoteMeta('projects/Inbox/notes/a.md', {
      path: 'projects/Inbox/notes/a2.md',
      name: 'a2',
      projectSlug: 'Inbox'
    });
    expect(useDocStore.getState().notePath).toBe('projects/Inbox/notes/a2.md');

    // Close active tab falls back cleanly to remaining tab
    useDocStore.getState().closeTab(useDocStore.getState().activeTabId);
    expect(useDocStore.getState().tabs).toHaveLength(1);
    expect(useDocStore.getState().content).toBe('BBB');
  });
});
