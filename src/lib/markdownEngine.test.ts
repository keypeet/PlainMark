import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdownEngine';

describe('markdownEngine', () => {
  it('renders markdown to html', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
  });

  it('sanitizes scripts', () => {
    const html = renderMarkdown('<script>alert("x")</script> **safe**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>safe</strong>');
  });
});
