import { describe, expect, it } from 'vitest';
import { noteGroupName, sanitizeName, todayGroupName } from './noteService';

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

describe('noteGroupName', () => {
  it('คืนชื่อโฟลเดอร์แม่ของโน้ต (กลุ่ม)', () => {
    expect(noteGroupName('C:\\Users\\x\\Documents\\PlainMark\\งานบริษัท\\โน้ตใหม่.md')).toBe('งานบริษัท');
    expect(noteGroupName('C:\\Users\\x\\Documents\\PlainMark\\2026-07-03\\meeting.md')).toBe('2026-07-03');
    expect(noteGroupName('/home/x/notes/กลุ่มA/note.md')).toBe('กลุ่มA');
  });

  it('path สั้นเกินกว่าจะมีกลุ่ม → null', () => {
    expect(noteGroupName('note.md')).toBeNull();
  });
});

describe('todayGroupName', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(todayGroupName(new Date(2026, 6, 2))).toBe('2026-07-02');
    expect(todayGroupName(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});
