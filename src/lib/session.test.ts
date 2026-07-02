import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';
import type { SessionState } from './session';

// jsdom ไม่มี __TAURI_INTERNALS__ → ทดสอบเส้นทาง browser fallback (localStorage)
function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    content: '# hello',
    filePath: null,
    fileName: 'untitled.md',
    notePath: null,
    dirty: true,
    updatedAt: 1234,
    ...overrides
  };
}

describe('session (browser fallback)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearSession();
  });

  it('roundtrips a session through saveSession/loadSession', async () => {
    const session = makeSession({ content: 'สวัสดี **PlainMark**', filePath: 'C:\\notes\\a.md', fileName: 'a.md' });
    await saveSession(session);
    expect(await loadSession()).toEqual(session);
  });

  it('keeps notePath and dirty flag intact', async () => {
    const session = makeSession({ notePath: 'C:\\Documents\\PlainMark\\2026-07-02\\x.md', dirty: false });
    await saveSession(session);
    const loaded = await loadSession();
    expect(loaded?.notePath).toBe(session.notePath);
    expect(loaded?.dirty).toBe(false);
  });

  it('returns null when stored session JSON is corrupted', async () => {
    localStorage.setItem('plainmark:session', '{not json');
    expect(await loadSession()).toBeNull();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('migrates a legacy plainmark:draft as a dirty session and removes the old key', async () => {
    localStorage.setItem(
      'plainmark:draft',
      JSON.stringify({ content: 'old draft', filePath: 'C:\\old\\note.md', updatedAt: 1 })
    );
    const loaded = await loadSession();
    expect(loaded?.content).toBe('old draft');
    expect(loaded?.fileName).toBe('note.md');
    expect(loaded?.dirty).toBe(true);
    expect(localStorage.getItem('plainmark:draft')).toBeNull();
  });

  it('last write wins across successive saves', async () => {
    await saveSession(makeSession({ content: 'first' }));
    await saveSession(makeSession({ content: 'second' }));
    expect((await loadSession())?.content).toBe('second');
  });

  it('clearSession removes the stored session', async () => {
    await saveSession(makeSession());
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});
