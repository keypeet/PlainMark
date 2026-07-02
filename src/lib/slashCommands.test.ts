import { describe, expect, it } from 'vitest';
import { filterSlashCommands, fuzzyMatch, slashCommands } from './slashCommands';

describe('fuzzyMatch', () => {
  it('ตัวอักษรเรียงลำดับถือว่าเจอ', () => {
    expect(fuzzyMatch('tbl', 'table')).toBe(true);
    expect(fuzzyMatch('h1', 'Heading 1')).toBe(true);
    expect(fuzzyMatch('หข', 'หัวข้อ')).toBe(true);
  });

  it('ตัวอักษรผิดลำดับ/ไม่มี → ไม่เจอ', () => {
    expect(fuzzyMatch('lbt', 'table')).toBe(false);
    expect(fuzzyMatch('xyz', 'quote')).toBe(false);
  });
});

describe('filterSlashCommands', () => {
  it('query ว่าง → คืนทุกคำสั่ง (ครบตามเอกสาร: heading/table/quote/image/code/todo/link)', () => {
    const ids = filterSlashCommands('').map((command) => command.id);
    for (const required of ['h1', 'table', 'quote', 'image', 'code', 'todo', 'link']) {
      expect(ids).toContain(required);
    }
  });

  it('ค้นด้วยคำอังกฤษ', () => {
    expect(filterSlashCommands('tab').some((command) => command.id === 'table')).toBe(true);
    expect(filterSlashCommands('todo').some((command) => command.id === 'todo')).toBe(true);
  });

  it('ค้นด้วยคำไทยผ่าน keywords', () => {
    expect(filterSlashCommands('ตาราง').some((command) => command.id === 'table')).toBe(true);
    expect(filterSlashCommands('รูป').some((command) => command.id === 'image')).toBe(true);
  });

  it('ทุกคำสั่งมีข้อความ insert', () => {
    for (const command of slashCommands) {
      expect(command.insert.length).toBeGreaterThan(0);
    }
  });
});
