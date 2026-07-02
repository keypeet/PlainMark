import { useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdownEngine';

// แปลง Markdown เป็น HTML แบบ debounce สั้นๆ ไม่ให้ render ถี่เกินตอนพิมพ์รัว
export function useRenderedMarkdown(content: string): string {
  const [html, setHtml] = useState(() => renderMarkdown(content));

  useEffect(() => {
    const timer = window.setTimeout(() => setHtml(renderMarkdown(content)), 40);
    return () => window.clearTimeout(timer);
  }, [content]);

  return html;
}
