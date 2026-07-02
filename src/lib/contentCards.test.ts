import { describe, expect, it } from 'vitest';
import { classifyUrl, githubRepo, isPdfUrl, youtubeVideoId } from './contentCards';
import { renderMarkdown } from './markdownEngine';

describe('youtubeVideoId', () => {
  it('รองรับ watch / youtu.be / shorts', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('URL อื่นไม่ใช่วิดีโอ', () => {
    expect(youtubeVideoId('https://www.youtube.com/feed/history')).toBeNull();
    expect(youtubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('githubRepo', () => {
  it('จับเฉพาะหน้า repo (owner/repo)', () => {
    expect(githubRepo('https://github.com/keypeet/PlainMark')).toBe('keypeet/PlainMark');
    expect(githubRepo('https://github.com/keypeet/PlainMark/issues/1')).toBeNull();
    expect(githubRepo('https://github.com/keypeet')).toBeNull();
    expect(githubRepo('https://gitlab.com/a/b')).toBeNull();
  });
});

describe('isPdfUrl', () => {
  it('ลงท้าย .pdf ใน path เท่านั้น', () => {
    expect(isPdfUrl('https://example.com/manual.pdf')).toBe(true);
    expect(isPdfUrl('https://example.com/manual.pdf?dl=1')).toBe(true);
    expect(isPdfUrl('https://example.com/page?file=x.pdf')).toBe(false);
  });
});

describe('classifyUrl', () => {
  it('mailto → email card', () => {
    expect(classifyUrl('mailto:someone@example.com')).toEqual({ type: 'email', title: 'someone@example.com' });
  });

  it('ลิงก์ธรรมดา → null', () => {
    expect(classifyUrl('https://example.com/blog')).toBeNull();
  });
});

describe('render เป็น card ใน preview (ผ่าน renderMarkdown จริง)', () => {
  it('ย่อหน้าที่มีแค่ YouTube URL → video card พร้อม thumbnail', () => {
    const html = renderMarkdown('ดูคลิปนี้\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n');
    expect(html).toContain('content-card card-youtube');
    expect(html).toContain('img.youtube.com/vi/dQw4w9WgXcQ');
  });

  it('reference-style link (แบบที่แอปย่อให้ตอน paste) → card เหมือนกัน', () => {
    const html = renderMarkdown('[คู่มือ][ref1]\n\n[ref1]: https://example.com/manual.pdf\n');
    expect(html).toContain('content-card card-pdf');
    expect(html).toContain('คู่มือ'); // ใช้ label ของผู้ใช้เป็นชื่อ card
  });

  it('อีเมลเปล่าๆ (linkify เป็น mailto) → mail card', () => {
    const html = renderMarkdown('someone@example.com\n');
    expect(html).toContain('content-card card-email');
  });

  it('ลิงก์ที่อยู่ปนกับข้อความ → ไม่กลายเป็น card (Markdown เดิมไม่เปลี่ยนความหมาย)', () => {
    const html = renderMarkdown('อ่านต่อที่ https://www.youtube.com/watch?v=dQw4w9WgXcQ นะ\n');
    expect(html).not.toContain('content-card');
    expect(html).toContain('<a');
  });

  it('GitHub repo URL → repository card', () => {
    const html = renderMarkdown('https://github.com/keypeet/PlainMark\n');
    expect(html).toContain('content-card card-github');
    expect(html).toContain('keypeet/PlainMark');
  });
});
