export interface LoadedFile {
  content: string;
  path: string | null;
  name: string;
}

function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function openTextFile(): Promise<LoadedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,.log,.ini,.json,text/markdown,text/plain';
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

export function exportTextFile(content: string, filename: string, extension: 'md' | 'txt'): void {
  const base = filename.replace(/\.(md|markdown|txt)$/i, '') || 'plainmark-note';
  downloadTextFile(content, `${base}.${extension}`);
}
