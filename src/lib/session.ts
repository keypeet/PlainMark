export interface SessionState {
  content: string;
  filePath: string | null;
  fileName: string;
  notePath: string | null;
  dirty: boolean;
  updatedAt: number;
}

const hasTauri = '__TAURI_INTERNALS__' in window;
const browserKey = 'plainmark:session';
const legacyDraftKey = 'plainmark:draft';
const sessionFileName = 'session.json';

// เขียนแบบเรียงคิวด้วย promise chain + เก็บ snapshot ล่าสุดเท่านั้น (latest wins)
// เพื่อให้ close handler await คิวทั้งหมดได้ผ่าน flushSession()
let writeChain: Promise<void> = Promise.resolve();
let pending: SessionState | null = null;

async function writeSessionFile(state: SessionState): Promise<void> {
  const [{ appDataDir, join }, fs] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs')
  ]);
  const dir = await appDataDir();
  await fs.mkdir(dir, { recursive: true });
  const target = await join(dir, sessionFileName);
  const tmp = await join(dir, `${sessionFileName}.tmp`);
  await fs.writeTextFile(tmp, JSON.stringify(state));
  await fs.rename(tmp, target);
}

export function saveSession(state: SessionState): Promise<void> {
  if (!hasTauri) {
    try {
      localStorage.setItem(browserKey, JSON.stringify(state));
    } catch {
      // localStorage เต็ม (เช่นรูป base64 ใหญ่) — โหมด browser เป็นแค่ fallback ตอน dev
    }
    return Promise.resolve();
  }

  pending = state;
  writeChain = writeChain
    .then(async () => {
      const snapshot = pending;
      pending = null;
      if (snapshot) await writeSessionFile(snapshot);
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
  if (hasTauri) {
    try {
      const [{ appDataDir, join }, fs] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-fs')
      ]);
      const target = await join(await appDataDir(), sessionFileName);
      if (await fs.exists(target)) {
        const session = parseSession(await fs.readTextFile(target));
        if (session) return session;
      }
    } catch (error) {
      console.error('PlainMark: session load failed', error);
    }
    return migrateLegacyDraft();
  }

  return parseSession(localStorage.getItem(browserKey)) ?? migrateLegacyDraft();
}

export async function clearSession(): Promise<void> {
  localStorage.removeItem(browserKey);
  if (!hasTauri) return;
  try {
    const [{ appDataDir, join }, fs] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs')
    ]);
    const target = await join(await appDataDir(), sessionFileName);
    if (await fs.exists(target)) await fs.remove(target);
  } catch (error) {
    console.error('PlainMark: session clear failed', error);
  }
}

// draft รุ่นเก่าเก็บใน localStorage รูปแบบ { content, filePath, updatedAt } — ย้ายมาครั้งเดียว
function migrateLegacyDraft(): SessionState | null {
  const raw = localStorage.getItem(legacyDraftKey);
  if (!raw) return null;
  localStorage.removeItem(legacyDraftKey);

  try {
    const draft = JSON.parse(raw) as { content?: unknown; filePath?: unknown };
    if (typeof draft.content !== 'string' || !draft.content) return null;
    const filePath = typeof draft.filePath === 'string' ? draft.filePath : null;
    return {
      content: draft.content,
      filePath,
      fileName: filePath?.split(/[\\/]/).pop() ?? 'untitled.md',
      notePath: null,
      dirty: true,
      updatedAt: Date.now()
    };
  } catch {
    return null;
  }
}

function parseSession(raw: string | null): SessionState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SessionState>;
    if (typeof value?.content !== 'string') return null;
    return {
      content: value.content,
      filePath: typeof value.filePath === 'string' ? value.filePath : null,
      fileName: typeof value.fileName === 'string' ? value.fileName : 'untitled.md',
      notePath: typeof value.notePath === 'string' ? value.notePath : null,
      dirty: value.dirty === true,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0
    };
  } catch {
    return null;
  }
}
