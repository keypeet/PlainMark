import { describe, expect, it } from 'vitest';
import { sanitizeName, todayGroupName } from './noteService';

describe('sanitizeName', () => {
  it('strips characters Windows forbids in filenames', () => {
    expect(sanitizeName('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('collapses whitespace and trims edges', () => {
    expect(sanitizeName('  ประชุม   ทีม  ')).toBe('ประชุม ทีม');
  });

  it('removes trailing dots (invalid on Windows)', () => {
    expect(sanitizeName('note...')).toBe('note');
  });

  it('falls back when the name becomes empty', () => {
    expect(sanitizeName('***', 'โน้ตใหม่')).toBe('โน้ตใหม่');
    expect(sanitizeName('   ')).toBe('untitled');
  });

  it('keeps Thai names intact', () => {
    expect(sanitizeName('งานบริษัท')).toBe('งานบริษัท');
  });
});

describe('todayGroupName', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(todayGroupName(new Date(2026, 6, 2))).toBe('2026-07-02');
    expect(todayGroupName(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});
