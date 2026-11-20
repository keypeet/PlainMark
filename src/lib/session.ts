import { apiLoadSession, apiSaveSession } from './api';
import type { LineEnding } from '../types';

export interface SavedTab {
  id: string;
  title: string;
  notePath: string | null;
  projectSlug: string | null;
  content: string;
  dirty: boolean;
  lineEnding?: LineEnding;
}

export interface SessionState {
  // v2 multi-tab session
  tabs?: SavedTab[];
  activeTabId?: string | null;
  // v1 legacy single-doc fields kept compatible for graceful migration & tests
  content?: string;
  filePath?: string | null;
  fileName?: string;
  notePath?: string | null;
  dirty?: boolean;
  updatedAt: number;
}

const browserKey = 'plainmark:session:v2';

let writeChain: Promise<void> = Promise.resolve();
let pending: SessionState | null = null;

function canUseBackend(): boolean {
  const mode = typeof import.meta !== 'undefined' ? (import.meta as { env?: { MODE?: string } }).env?.MODE : undefined;
  if (mode === 'test') return false;
  return typeof window !== 'undefined' && typeof fetch === 'function' && window.location.protocol.startsWith('http');
}

export function saveSession(state: SessionState): Promise<void> {
  try {
    localStorage.setItem(browserKey, JSON.stringify(state));
  } catch {
    // localStorage quota exceeded — backend session.json still persists
  }

  if (!canUseBackend()) return Promise.resolve();

  pending = state;
  writeChain = writeChain
    .then(async () => {
      const snapshot = pending;
      pending = null;
      if (snapshot) await apiSaveSession(snapshot);
    })
    .catch((error) => {
      console.error('PlainMark: session save failed', error);
    });
  return writeChain;
}

export function flushSession(): Promise<void> {
  return writeChain;
}

export async function loadSession(): Promise<SessionState | null> {
  if (canUseBackend()) {
    try {
      const { session } = await apiLoadSession<SessionState>();
      if (session && typeof session === 'object') return session;
    } catch {
      // backend unreachable during tests or startup fallback
    }
  }
  const raw = localStorage.getItem(browserKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  localStorage.removeItem(browserKey);
  if (canUseBackend()) {
    try {
      await apiSaveSession({ tabs: [], activeTabId: null, updatedAt: Date.now() });
    } catch {
      // ignore
    }
  }
}
