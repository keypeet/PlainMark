import { describe, expect, it } from 'vitest';
import { convertClipboardHtml, htmlToMarkdown, shouldConvertHtml } from './pasteConvert';

describe('shouldConvertHtml', () => {
  it('HTML มีโครงสร้าง → ควรแปลง', () => {
    expect(shouldConvertHtml('<h1>Title</h1>')).toBe(true);
    expect(shouldConvertHtml('<table><tr><td>1</td></tr></table>')).toBe(true);
    expect(shouldConvertHtml('<ul><li>item</li></ul>')).toBe(true);
    expect(shouldConvertHtml('<b>bold</b>')).toBe(true);
    expect(shouldConvertHtml('<a href="https://x.com">x</a>')).toBe(true);
  });

  it('แค่ span/div ห่อข้อความ → ไม่ต้องแปลง (ใช้ plain text ดีกว่า)', () => {
    expect(shouldConvertHtml('<div><span>plain text</span></div>')).toBe(false);
    expect(shouldConvertHtml('<p>just a paragraph</p>')).toBe(false);
  });
});

describe('htmlToMarkdown', () => {
  it('heading + ตัวหนา → Markdown', () => {
    expect(htmlToMarkdown('<h2>หัวข้อ</h2><p>มี <strong>ตัวหนา</strong></p>')).toBe('## หัวข้อ\n\nมี **ตัวหนา**');
  });

  it('ตารางแบบ Excel → Markdown Table (GFM)', () => {
    const html =
      '<table><tr><th>ชื่อ</th><th>ราคา</th></tr><tr><td>ปากกา</td><td>10</td></tr></table>';
    const markdown = htmlToMarkdown(html);
    expect(markdown).toContain('| ชื่อ | ราคา |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| ปากกา | 10 |');
  });

  it('ลิงก์ → [text](url)', () => {
    expect(htmlToMarkdown('<a href="https://example.com">ตัวอย่าง</a>')).toBe('[ตัวอย่าง](https://example.com)');
  });

  it('list ซ้อน → Markdown list', () => {
    const markdown = htmlToMarkdown('<ul><li>หนึ่ง</li><li>สอง</li></ul>');
    expect(markdown).toBe('- หนึ่ง\n- สอง');
  });
});

describe('convertClipboardHtml', () => {
  it('ไม่มี HTML หรือไม่มีโครงสร้าง → null', () => {
    expect(convertClipboardHtml(undefined)).toBeNull();
    expect(convertClipboardHtml('')).toBeNull();
    expect(convertClipboardHtml('<span>text</span>')).toBeNull();
  });

  it('HTML มีโครงสร้าง → Markdown', () => {
    expect(convertClipboardHtml('<h1>Hi</h1>')).toBe('# Hi');
  });
});
