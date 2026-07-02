import { describe, expect, it } from 'vitest';
import {
  createImage,
  createLink,
  createTable,
  insertReferenceLink,
  prefixLines,
  prefixOrderedList,
  toggleHeading,
  wrapSelection
} from './formatActions';

describe('formatActions', () => {
  it('wraps selected text', () => {
    const result = wrapSelection('hello', { from: 0, to: 5 }, '**', '**', 'text');
    expect(result.content).toBe('**hello**');
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(7);
  });

  it('uses placeholder when selection is empty', () => {
    const result = wrapSelection('', { from: 0, to: 0 }, '`', '`', 'code');
    expect(result.content).toBe('`code`');
    expect(result.selectionStart).toBe(1);
    expect(result.selectionEnd).toBe(5);
  });

  it('prefixes selected lines', () => {
    const result = prefixLines('a\nb', { from: 0, to: 3 }, '- ');
    expect(result.content).toBe('- a\n- b');
  });

  it('toggles a heading prefix', () => {
    const added = toggleHeading('Title', { from: 0, to: 0 }, 1);
    expect(added.content).toBe('# Title');

    const removed = toggleHeading(added.content, { from: 2, to: 2 }, 1);
    expect(removed.content).toBe('Title');
  });

  it('creates a table with the requested rows and columns', () => {
    const result = createTable('', { from: 0, to: 0 }, 3, 4);
    const lines = result.content.trim().split('\n');
    expect(lines[0]).toBe('| Column 1 | Column 2 | Column 3 | Column 4 |');
    expect(lines[1]).toBe('| --- | --- | --- | --- |');
    expect(lines).toHaveLength(2 + 3); // header + divider + 3 body rows
  });

  it('clamps table size to sane bounds', () => {
    const result = createTable('', { from: 0, to: 0 }, 0, 99);
    const lines = result.content.trim().split('\n');
    expect(lines).toHaveLength(3); // อย่างน้อย 1 แถว
    expect(lines[0].split('|').filter((cell) => cell.trim()).length).toBe(10); // สูงสุด 10 คอลัมน์
  });

  it('numbers selected lines sequentially, skipping blanks', () => {
    const result = prefixOrderedList('a\n\nb\nc', { from: 0, to: 6 });
    expect(result.content).toBe('1. a\n\n2. b\n3. c');
  });

  it('inserts short links inline', () => {
    const result = createLink('hello', { from: 0, to: 5 }, 'https://a.co');
    expect(result.content).toBe('[hello](https://a.co)');
  });

  it('converts long link URLs to reference style', () => {
    const longUrl = `https://example.com/${'x'.repeat(60)}`;
    const result = createLink('hello', { from: 0, to: 5 }, longUrl);
    expect(result.content).toContain('[hello][ref1]');
    expect(result.content).toContain(`[ref1]: ${longUrl}`);
    expect(result.content).not.toContain(`(${longUrl})`);
  });

  it('converts long image URLs to reference style', () => {
    const longUrl = `https://example.com/${'x'.repeat(60)}.png`;
    const result = createImage('', { from: 0, to: 0 }, longUrl);
    expect(result.content).toContain('![รูปภาพ][img1]');
    expect(result.content).toContain(`[img1]: ${longUrl}`);
  });

  it('allocates unique reference ids without colliding', () => {
    const first = insertReferenceLink('', { from: 0, to: 0 }, 'https://one.example', 'link', 'one');
    const second = insertReferenceLink(
      first.content,
      { from: 0, to: 0 },
      'https://two.example',
      'link',
      'two'
    );
    expect(second.content).toContain('[ref1]: https://one.example');
    expect(second.content).toContain('[ref2]: https://two.example');
  });
});
