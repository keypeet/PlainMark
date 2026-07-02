import { describe, expect, it } from 'vitest';
import { baseName, pathSegments } from './paths';

describe('pathSegments', () => {
  it('แยก path ได้ทั้ง \\ ของ Windows และ /', () => {
    expect(pathSegments('C:\\Users\\x\\note.md')).toEqual(['C:', 'Users', 'x', 'note.md']);
    expect(pathSegments('/home/x/note.md')).toEqual(['home', 'x', 'note.md']);
    expect(pathSegments('C:\\Users\\x\\กลุ่ม/note.md')).toEqual(['C:', 'Users', 'x', 'กลุ่ม', 'note.md']);
  });
});

describe('baseName', () => {
  it('คืนชื่อไฟล์/โฟลเดอร์ท้ายสุดของ path', () => {
    expect(baseName('C:\\Users\\x\\งานบริษัท\\โน้ตใหม่.md')).toBe('โน้ตใหม่.md');
    expect(baseName('/home/x/notes/กลุ่มA')).toBe('กลุ่มA');
    expect(baseName('C:\\Users\\x\\dir\\')).toBe('dir');
  });

  it('path ว่าง → string ว่าง', () => {
    expect(baseName('')).toBe('');
  });
});
