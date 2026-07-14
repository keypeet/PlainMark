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

  it('removes bold when the inner text is selected inside markers (toggle)', () => {
    const result = wrapSelection('**hello**', { from: 2, to: 7 }, '**', '**', 'bold text');
    expect(result.content).toBe('hello');
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(5);
  });

  it('removes bold when the selection includes the markers (toggle)', () => {
    const result = wrapSelection('**hello**', { from: 0, to: 9 }, '**', '**', 'bold text');
    expect(result.content).toBe('hello');
  });

  it('stacks italic on top of bold as triple stars', () => {
    const result = wrapSelection('**hi**', { from: 0, to: 6 }, '*', '*', 'italic text');
    expect(result.content).toBe('***hi***');
  });

  it('removes only bold from bold+italic text', () => {
    const result = wrapSelection('***hi***', { from: 0, to: 8 }, '**', '**', 'bold text');
    expect(result.content).toBe('*hi*');
  });

  it('bolds the text after a heading marker when the whole line is selected', () => {
    const result = wrapSelection('# Hello', { from: 0, to: 7 }, '**', '**', 'bold text');
    expect(result.content).toBe('# **Hello**');
  });

  it('bolds each cell of a table row instead of breaking the table', () => {
    const row = '| Name | Status |';
    const result = wrapSelection(row, { from: 0, to: row.length }, '**', '**', 'bold text');
    expect(result.content).toBe('| **Name** | **Status** |');
  });

  it('toggles table-cell bold back off on second apply', () => {
    const row = '| **Name** | **Status** |';
    const result = wrapSelection(row, { from: 0, to: row.length }, '**', '**', 'bold text');
    expect(result.content).toBe('| Name | Status |');
  });

  it('skips table separator rows when bolding a multi-row selection', () => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const result = wrapSelection(table, { from: 0, to: table.length }, '**', '**', 'bold text');
    expect(result.content).toBe('| **A** | **B** |\n| --- | --- |\n| **1** | **2** |');
  });

  it('wraps each line of a multi-line selection separately', () => {
    const result = wrapSelection('one\ntwo', { from: 0, to: 7 }, '**', '**', 'bold text');
    expect(result.content).toBe('**one**\n**two**');
  });

  it('keeps list markers outside the inline wrap', () => {
    const result = wrapSelection('- item\n- next', { from: 0, to: 13 }, '*', '*', 'italic text');
    expect(result.content).toBe('- *item*\n- *next*');
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
    expect(lines[0]).toBe('|     |     |     |     |'); // หัวตารางว่าง — กรอกเองในกริด
    expect(lines[1]).toBe('| --- | --- | --- | --- |');
    expect(lines).toHaveLength(2 + 3); // header + divider + 3 body rows
  });

  it('places the cursor after the inserted table so full mode renders the grid immediately', () => {
    const result = createTable('', { from: 0, to: 0 }, 2, 2);
    expect(result.selectionStart).toBe(result.content.length);
    expect(result.selectionEnd).toBe(result.content.length);
  });

  it('clamps table size to sane bounds', () => {
    const result = createTable('', { from: 0, to: 0 }, 0, 99);
    const lines = result.content.trim().split('\n');
    expect(lines).toHaveLength(3); // อย่างน้อย 1 แถว
    expect(lines[1].split('|').filter((cell) => cell.trim()).length).toBe(10); // สูงสุด 10 คอลัมน์ (นับจากแถวคั่น)
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
