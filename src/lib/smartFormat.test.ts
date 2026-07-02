import { describe, expect, it } from 'vitest';
import { enterActionForLine, expandShorthand } from './smartFormat';

describe('enterActionForLine', () => {
  it('ต่อ bullet list', () => {
    expect(enterActionForLine('- งานแรก')).toEqual({ kind: 'continue', marker: '- ' });
    expect(enterActionForLine('* item')).toEqual({ kind: 'continue', marker: '* ' });
  });

  it('ต่อ ordered list โดยเพิ่มเลข', () => {
    expect(enterActionForLine('1. หนึ่ง')).toEqual({ kind: 'continue', marker: '2. ' });
    expect(enterActionForLine('12. สิบสอง')).toEqual({ kind: 'continue', marker: '13. ' });
  });

  it('ต่อ checklist เป็นช่องว่างเสมอ (แม้บรรทัดเดิมติ๊กแล้ว)', () => {
    expect(enterActionForLine('- [ ] งาน')).toEqual({ kind: 'continue', marker: '- [ ] ' });
    expect(enterActionForLine('- [x] เสร็จ')).toEqual({ kind: 'continue', marker: '- [ ] ' });
  });

  it('ต่อ quote', () => {
    expect(enterActionForLine('> ข้อความ')).toEqual({ kind: 'continue', marker: '> ' });
  });

  it('รักษา indent ของ nested list', () => {
    expect(enterActionForLine('  - ลูก')).toEqual({ kind: 'continue', marker: '  - ' });
    expect(enterActionForLine('   2. ลูก')).toEqual({ kind: 'continue', marker: '   3. ' });
  });

  it('marker ว่างเปล่า → ออกจาก list', () => {
    expect(enterActionForLine('- ')).toEqual({ kind: 'exit' });
    expect(enterActionForLine('3. ')).toEqual({ kind: 'exit' });
    expect(enterActionForLine('- [ ] ')).toEqual({ kind: 'exit' });
    expect(enterActionForLine('> ')).toEqual({ kind: 'exit' });
  });

  it('บรรทัดธรรมดา → ไม่ยุ่ง', () => {
    expect(enterActionForLine('ข้อความปกติ')).toEqual({ kind: 'none' });
    expect(enterActionForLine('# หัวข้อ')).toEqual({ kind: 'none' });
    expect(enterActionForLine('')).toEqual({ kind: 'none' });
  });
});

describe('expandShorthand', () => {
  it('[] + space → เช็คบ็อกซ์', () => {
    expect(expandShorthand('[]')).toEqual({ replaceFrom: 0, insert: '- [ ] ' });
    expect(expandShorthand('  []')).toEqual({ replaceFrom: 2, insert: '- [ ] ' });
  });

  it('ไม่ขยายเมื่อไม่ใช่ shorthand ต้นบรรทัด', () => {
    expect(expandShorthand('ข้อความ []')).toBeNull();
    expect(expandShorthand(']')).toBeNull();
    expect(expandShorthand('- [ ]')).toBeNull();
  });
});
