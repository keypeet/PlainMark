import { describe, expect, it } from 'vitest';
import { embedImageAsset, embedImageReference } from './imagePaste';
import { renderMarkdown } from './markdownEngine';

const pngDataUrl = `data:image/png;base64,${'A'.repeat(80)}`;

describe('embedImageReference', () => {
  it('renders as an actual <img> in the preview, not as literal text', () => {
    const result = embedImageReference('บันทึกของฉัน', 'บันทึกของฉัน'.length, pngDataUrl);
    const html = renderMarkdown(result.content);
    expect(html).toContain('<img');
    expect(html).toContain(pngDataUrl);
    // นิยามลิงก์ต้องถูก consume ไม่หลุดมาเป็นข้อความ
    expect(html).not.toContain('[img1]:');
  });

  it('separates the reference definition with a blank line', () => {
    const result = embedImageReference('paragraph', 'paragraph'.length, pngDataUrl);
    expect(result.content).toContain('\n\n[img1]: data:image/png;base64,');
  });

  it('allocates sequential image ids across pastes', () => {
    const first = embedImageReference('note', 4, pngDataUrl);
    const second = embedImageReference(first.content, 4, pngDataUrl);
    expect(second.content).toContain('[img1]:');
    expect(second.content).toContain('[img2]:');
    const html = renderMarkdown(second.content);
    expect((html.match(/<img/g) ?? []).length).toBe(2);
  });

  it('uses a compact relative path for image assets', () => {
    const result = embedImageAsset('note', 4, 'new note.assets/image-123.png');
    expect(result.content).toBe('note\n![image](new%20note.assets/image-123.png)\n');
    expect(renderMarkdown(result.content)).toContain('src="new%20note.assets/image-123.png"');
  });
});
