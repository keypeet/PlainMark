export interface LoadedFile {
  content: string;
  path: string | null;
  name: string;
}

const hasTauri = '__TAURI_INTERNALS__' in window;

function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function pickBrowserFile(): Promise<LoadedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ content: await file.text(), path: null, name: file.name });
    };
    input.click();
  });
}

export async function openTextFile(): Promise<LoadedFile | null> {
  if (!hasTauri) return pickBrowserFile();

  const [{ open }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ]);
  const selectedPath = await open({
    multiple: false,
    filters: [{ name: 'Text', extensions: ['md', 'markdown', 'txt'] }]
  });

  if (typeof selectedPath !== 'string') return null;

  const content = await readTextFile(selectedPath);
  return {
    content,
    path: selectedPath,
    name: selectedPath.split(/[\\/]/).pop() ?? 'untitled.md'
  };
}

export async function saveTextFile(content: string, path: string | null): Promise<LoadedFile | null> {
  if (!hasTauri) {
    downloadTextFile(content, path ?? 'untitled.md');
    return { content, path: null, name: path ?? 'untitled.md' };
  }

  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ]);
  const targetPath =
    path ??
    (await save({
      defaultPath: 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }));

  if (!targetPath) return null;
  await writeTextFile(targetPath, content);

  return {
    content,
    path: targetPath,
    name: targetPath.split(/[\\/]/).pop() ?? 'untitled.md'
  };
}

export async function exportTextFile(content: string, extension: 'md' | 'txt'): Promise<void> {
  const filename = `plainmark-export.${extension}`;

  if (!hasTauri) {
    downloadTextFile(content, filename);
    return;
  }

  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ]);
  const targetPath = await save({
    defaultPath: filename,
    filters: [{ name: extension === 'md' ? 'Markdown' : 'Plain Text', extensions: [extension] }]
  });

  if (targetPath) {
    await writeTextFile(targetPath, content);
  }
}
