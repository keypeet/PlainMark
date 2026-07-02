import { describe, expect, it } from 'vitest';
import { prefixLines, toggleHeading, wrapSelection } from './formatActions';

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
});
