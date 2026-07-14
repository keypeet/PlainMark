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

  // ตารางที่แทรกใหม่หัวว่างทุกช่อง — ต้อง render เป็น <table> ได้ ไม่งั้นกริดกรอกช่องในโหมด full ไม่ขึ้น
  it('renders a table whose header cells are all empty', () => {
    const html = renderMarkdown('|     |     |\n| --- | --- |\n|     |     |');
    expect(html).toContain('<table');
    expect((html.match(/<th>/g) ?? []).length).toBe(2);
    expect((html.match(/<td>/g) ?? []).length).toBe(2);
  });
});
