import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';
import type { SessionState } from './session';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    tabs: [
      {
        id: 't1',
        title: 'hello',
        notePath: 'projects/Inbox/notes/hello.md',
        projectSlug: 'Inbox',
        content: '# hello',
        dirty: true,
        lineEnding: 'LF'
      }
    ],
    activeTabId: 't1',
    updatedAt: 1234,
    ...overrides
  };
}

describe('session (localStorage fallback in jsdom)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearSession();
  });

  it('roundtrips a multi-tab session through saveSession/loadSession', async () => {
    const session = makeSession();
    await saveSession(session);
    expect(await loadSession()).toEqual(session);
  });

  it('returns null when stored session JSON is corrupted', async () => {
    localStorage.setItem('plainmark:session:v2', '{not json');
    expect(await loadSession()).toBeNull();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('last write wins across successive saves', async () => {
    await saveSession(makeSession({ activeTabId: 'a' }));
    await saveSession(makeSession({ activeTabId: 'b' }));
    expect((await loadSession())?.activeTabId).toBe('b');
  });

  it('clearSession removes the stored session', async () => {
    await saveSession(makeSession());
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});
