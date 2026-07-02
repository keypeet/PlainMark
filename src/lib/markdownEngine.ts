import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: (code, language) => {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        return '';
      }
    }
    return hljs.highlightAuto(code).value;
  }
}).use(taskLists, { enabled: false, label: true, labelAfter: true });

const allowedUriRegexp =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$)|data:image\/(?:png|gif|jpe?g|webp|svg\+xml);base64,)/i;

export function renderMarkdown(markdownSource: string): string {
  const unsafeHtml = markdown.render(markdownSource);

  return DOMPurify.sanitize(unsafeHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'checked', 'disabled'],
    ALLOWED_URI_REGEXP: allowedUriRegexp
  });
}
