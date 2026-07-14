import { useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdownEngine';
import { hasTauri, tauriCore, tauriPath } from '../lib/platform';

async function resolveLocalImages(html: string, documentPath: string | null): Promise<string> {
  if (!hasTauri || !documentPath || !html.includes('<img')) return html;
  const [{ dirname, join }, { convertFileSrc }] = await Promise.all([tauriPath(), tauriCore()]);
  const documentDir = await dirname(documentPath);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  for (const image of wrapper.querySelectorAll('img')) {
    const source = image.getAttribute('src');
    if (!source || /^(?:[a-z][a-z+.-]*:|\/)/i.test(source)) continue;
    image.setAttribute('src', convertFileSrc(await join(documentDir, decodeURIComponent(source))));
  }
  return wrapper.innerHTML;
}

// แปลง Markdown เป็น HTML แบบ debounce สั้นๆ ไม่ให้ render ถี่เกินตอนพิมพ์รัว
export function useRenderedMarkdown(content: string, documentPath: string | null): string {
  const [html, setHtml] = useState(() => renderMarkdown(content));

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void resolveLocalImages(renderMarkdown(content), documentPath).then((nextHtml) => {
        if (!cancelled) setHtml(nextHtml);
      });
    }, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [content, documentPath]);

  return html;
}
