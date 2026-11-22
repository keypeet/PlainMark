// HTTP client for the local PlainMark v2 FastAPI backend (127.0.0.1:4985).
// Same-origin in production (served by FastAPI) and proxied via Vite in dev.

export interface NoteMeta {
  name: string;
  path: string;
  scope?: string;
  projectSlug: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMeta {
  slug: string;
  name: string;
  path: string;
  createdAt: number;
  repoPath: string | null;
  glossary: string[];
  hidden?: boolean;
  defaultVisibility?: 'local_only' | 'shareable';
  notes: NoteMeta[];
}

export interface ScratchMeta {
  id: string;
  title: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScratchDoc extends ScratchMeta {
  content: string;
}

export interface ClosedItem {
  id: string;
  itemType: 'card' | 'note' | 'scratch';
  scope: string;
  title: string;
  reason: string;
  assignee: string;
  note: string;
  snapshot: Record<string, unknown>;
  closedAt: number;
  restored: boolean;
  restoredAt: number | null;
}

export interface AiRoleConfig {
  provider: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
}

export interface BackendSettings {
  appearance: {
    themeMode: 'light' | 'dark' | 'system';
    accentColor: string;
    fontFamily: string;
    fontSize: number;
  };
  aiDefaults: {
    insights: AiRoleConfig;
    meetings: AiRoleConfig;
    knowledge: AiRoleConfig;
    assistant: AiRoleConfig;
  };
  backup: {
    enabled: boolean;
    destination: string;
    keepDaily: number;
    keepWeekly: number;
  };
  privacy: {
    defaultMeetingVisibility: 'local_only' | 'shareable';
    redactPiiOnCloud: boolean;
    anonymousMode?: boolean;
  };
  sync?: {
    autoSyncEnabled?: boolean;
  };
}

export interface CliInfo {
  name: string;
  label: string;
  type: 'local' | 'cloud';
  available: boolean;
  executable: string | null;
  efforts: string[];
  models: string[];
}

export interface CliCache {
  discoveredAt: number;
  clis: Record<string, CliInfo>;
}

export interface VoiceprintItem {
  id: string;
  name: string;
  nickname: string;
  email: string;
  embedding: number[];
  projects: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ContactItem {
  id: string;
  name: string;
  nickname: string;
  email: string;
  createdAt: number;
  updatedAt: number;
}

export interface SnapshotMeta {
  path: string;
  savedAt: number;
}

export interface SearchHit {
  path: string;
  projectSlug: string;
  projectName: string;
  title: string;
  snippet: string;
  updatedAt: number;
}

export interface HealthInfo {
  status: string;
  version: string;
  dataRoot: string;
  legacyNotesAvailable: boolean;
  legacyNotesPath: string;
  modules: Record<string, string>;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // ignore non-json error body
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

export function apiHealth(): Promise<HealthInfo> {
  return requestJson<HealthInfo>('/api/health');
}

export function apiListProjects(): Promise<{ dataRoot: string; projects: ProjectMeta[] }> {
  return requestJson('/api/projects');
}

export function apiCreateProject(name: string, repoPath?: string | null): Promise<ProjectMeta> {
  return requestJson('/api/projects', jsonInit('POST', { name, repoPath: repoPath ?? null }));
}

export function apiUpdateProject(
  slug: string,
  patch: {
    name?: string;
    repoPath?: string | null;
    glossary?: string[];
    hidden?: boolean;
    defaultVisibility?: 'local_only' | 'shareable';
  }
): Promise<ProjectMeta> {
  return requestJson(`/api/projects/${encodeURIComponent(slug)}`, jsonInit('PATCH', patch));
}

export function apiDeleteProject(slug: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

export function apiListNotes(scope = 'all', includeHidden = false): Promise<{ notes: NoteMeta[] }> {
  const params = new URLSearchParams({ scope, includeHidden: String(includeHidden) });
  return requestJson(`/api/notes?${params.toString()}`);
}

export function apiCreateNote(projectSlug?: string, title?: string, scope?: string): Promise<NoteMeta> {
  return requestJson(
    '/api/notes',
    jsonInit('POST', { projectSlug: projectSlug ?? null, title: title ?? null, scope: scope ?? null })
  );
}

export function apiReadNote(path: string): Promise<NoteMeta & { content: string }> {
  return requestJson(`/api/notes/read?path=${encodeURIComponent(path)}`);
}

export function apiWriteNote(
  path: string,
  content: string,
  options?: { mustExist?: boolean; historyIntervalMin?: number; historyKeep?: number }
): Promise<{ saved: boolean; reason?: string; path: string; updatedAt?: number }> {
  return requestJson(
    '/api/notes/write',
    jsonInit('POST', {
      path,
      content,
      mustExist: options?.mustExist ?? true,
      historyIntervalMin: options?.historyIntervalMin ?? 5,
      historyKeep: options?.historyKeep ?? 30
    })
  );
}

export function apiRenameNote(path: string, newTitle: string): Promise<NoteMeta> {
  return requestJson('/api/notes/rename', jsonInit('POST', { path, newTitle }));
}

export function apiMoveNote(
  path: string,
  targetProjectSlug?: string,
  targetScope?: string
): Promise<NoteMeta> {
  return requestJson(
    '/api/notes/move',
    jsonInit('POST', { path, targetProjectSlug: targetProjectSlug ?? null, targetScope: targetScope ?? null })
  );
}

export function apiMoveItem(
  itemType: 'note' | 'meeting' | 'knowledge',
  idOrPath: string,
  targetScope: string
): Promise<unknown> {
  return requestJson('/api/move', jsonInit('POST', { itemType, idOrPath, targetScope }));
}

export function apiDeleteNote(path: string): Promise<{ deleted: boolean }> {
  return requestJson('/api/notes/delete', jsonInit('POST', { path }));
}

export function apiListHistory(path: string): Promise<{ snapshots: SnapshotMeta[] }> {
  return requestJson(`/api/notes/history?path=${encodeURIComponent(path)}`);
}

export function apiReadHistory(path: string): Promise<{ path: string; content: string }> {
  return requestJson(`/api/notes/history/read?path=${encodeURIComponent(path)}`);
}

export function apiSaveHistory(path: string, content: string, keep = 30): Promise<{ saved: boolean }> {
  return requestJson('/api/notes/history/save', jsonInit('POST', { path, content, keep }));
}

export async function apiUploadAsset(notePath: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('notePath', notePath);
  form.append('file', file, file.name || 'image.png');
  const data = await requestJson<{ relativePath: string }>('/api/notes/assets', {
    method: 'POST',
    body: form
  });
  return data.relativePath;
}

export function assetImageUrl(notePath: string, rel: string): string {
  return `/api/notes/assets/file?notePath=${encodeURIComponent(notePath)}&rel=${encodeURIComponent(rel)}`;
}

export function apiInlineImages(path: string, content: string): Promise<{ content: string }> {
  return requestJson('/api/notes/inline-images', jsonInit('POST', { path, content }));
}

export function apiSearch(query: string, projectSlug?: string): Promise<{ results: SearchHit[] }> {
  const params = new URLSearchParams({ q: query });
  if (projectSlug) params.set('project', projectSlug);
  return requestJson(`/api/search?${params.toString()}`);
}

export function apiLoadSession<T>(): Promise<{ session: T | null }> {
  return requestJson('/api/session');
}

export function apiSaveSession(payload: unknown): Promise<{ saved: boolean }> {
  return requestJson('/api/session', jsonInit('PUT', payload));
}

export function apiImportLegacy(sourceDir?: string): Promise<{
  importedProjects: number;
  importedNotes: number;
  source: string;
}> {
  return requestJson('/api/import-legacy', jsonInit('POST', { sourceDir: sourceDir ?? null }));
}

export function apiListScratches(): Promise<{ scratches: ScratchMeta[] }> {
  return requestJson('/api/scratches');
}

export function apiCreateScratch(title?: string, content = ''): Promise<ScratchDoc> {
  return requestJson('/api/scratches', jsonInit('POST', { title: title ?? null, content }));
}

export function apiReadScratch(scratchId: string): Promise<ScratchDoc> {
  return requestJson(`/api/scratches/${encodeURIComponent(scratchId)}`);
}

export function apiUpdateScratch(scratchId: string, content: string, title?: string): Promise<ScratchDoc> {
  return requestJson(
    `/api/scratches/${encodeURIComponent(scratchId)}`,
    jsonInit('PUT', { content, title: title ?? null })
  );
}

export function apiDeleteScratch(scratchId: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/scratches/${encodeURIComponent(scratchId)}`, { method: 'DELETE' });
}

export function apiPromoteScratch(
  scratchId: string,
  targetScope = 'general',
  title?: string,
  keepScratch = false
): Promise<{ note: NoteMeta & { content: string }; deletedScratch: boolean }> {
  return requestJson(
    `/api/scratches/${encodeURIComponent(scratchId)}/promote`,
    jsonInit('POST', { targetScope, title: title ?? null, keepScratch })
  );
}

export function apiListClosedItems(scope?: string): Promise<{ items: ClosedItem[] }> {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  return requestJson(`/api/closed-items${qs}`);
}

export function apiRecordClosedItem(payload: {
  itemType: 'card' | 'note' | 'scratch';
  scope: string;
  title: string;
  reason: string;
  assignee?: string;
  note?: string;
  snapshot?: Record<string, unknown>;
}): Promise<ClosedItem> {
  return requestJson('/api/closed-items', jsonInit('POST', payload));
}

export function apiRestoreClosedItem(itemId: string): Promise<{ item: ClosedItem }> {
  return requestJson(`/api/closed-items/${encodeURIComponent(itemId)}/restore`, jsonInit('POST', {}));
}

export function apiGetSettings(): Promise<{ settings: BackendSettings; cliCache: CliCache | null }> {
  return requestJson('/api/settings');
}

export function apiUpdateSettings(patch: Record<string, unknown>): Promise<{ settings: BackendSettings }> {
  return requestJson('/api/settings', jsonInit('PUT', patch));
}

export function apiDiscoverClis(): Promise<CliCache> {
  return requestJson('/api/cli/discover', jsonInit('POST', {}));
}

export function apiSmartSync(body: { scope?: string; force?: boolean } = {}): Promise<{
  results: Array<{ scope: string; status: string; tokensUsed: number; source_hash: string }>;
}> {
  return requestJson('/api/sync/smart', jsonInit('POST', body));
}

export function apiRunBackup(body: {
  destination?: string;
  keepDaily?: number;
  keepWeekly?: number;
}): Promise<{ backedUpFiles: number; skippedFiles: number; dailyPath: string; timestamp: string }> {
  return requestJson('/api/backup/run', jsonInit('POST', body));
}

export function apiRebuildIndex(): Promise<{ rebuilt: boolean; indexedNotes: number }> {
  return requestJson('/api/index/rebuild', jsonInit('POST', {}));
}

export function apiListVoiceprints(): Promise<{ voiceprints: VoiceprintItem[] }> {
  return requestJson('/api/voiceprints');
}

export function apiCreateVoiceprint(payload: {
  name: string;
  nickname?: string;
  email?: string;
  embedding?: number[];
}): Promise<VoiceprintItem> {
  return requestJson('/api/voiceprints', jsonInit('POST', payload));
}

export function apiUpdateVoiceprint(
  vpId: string,
  payload: Partial<Pick<VoiceprintItem, 'name' | 'nickname' | 'email'>>
): Promise<VoiceprintItem> {
  return requestJson(`/api/voiceprints/${encodeURIComponent(vpId)}`, jsonInit('PATCH', payload));
}

export function apiDeleteVoiceprint(vpId: string): Promise<{ deleted: boolean; id: string }> {
  return requestJson(`/api/voiceprints/${encodeURIComponent(vpId)}`, { method: 'DELETE' });
}

export function apiListContacts(): Promise<{ contacts: ContactItem[] }> {
  return requestJson('/api/contacts');
}

export function apiUpsertContact(payload: {
  id?: string;
  name: string;
  nickname?: string;
  email?: string;
}): Promise<ContactItem> {
  return requestJson('/api/contacts', jsonInit('POST', payload));
}

export function apiDeleteContact(contactId: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
}

export function apiListMeetings(scope = 'all', limit = 20): Promise<{ items: unknown[]; total: number }> {
  const params = new URLSearchParams({ scope, limit: String(limit) });
  return requestJson(`/api/meetings?${params.toString()}`);
}

export function apiListKnowledge(scope = 'all'): Promise<{ items: unknown[] }> {
  const params = new URLSearchParams({ scope });
  return requestJson(`/api/knowledge?${params.toString()}`);
}
