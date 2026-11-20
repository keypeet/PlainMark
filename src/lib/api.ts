// HTTP client for the local PlainMark v2 FastAPI backend (127.0.0.1:4985).
// Same-origin in production (served by FastAPI) and proxied via Vite in dev.

export interface NoteMeta {
  name: string;
  path: string;
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
  notes: NoteMeta[];
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
  patch: { name?: string; repoPath?: string | null; glossary?: string[] }
): Promise<ProjectMeta> {
  return requestJson(`/api/projects/${encodeURIComponent(slug)}`, jsonInit('PATCH', patch));
}

export function apiDeleteProject(slug: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

export function apiCreateNote(projectSlug?: string, title?: string): Promise<NoteMeta> {
  return requestJson('/api/notes', jsonInit('POST', { projectSlug: projectSlug ?? null, title: title ?? null }));
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

export function apiMoveNote(path: string, targetProjectSlug: string): Promise<NoteMeta> {
  return requestJson('/api/notes/move', jsonInit('POST', { path, targetProjectSlug }));
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
