import { describe, expect, it } from 'vitest';
import { fixTableBlock } from './tableFormat';

function cursorAt(content: string, needle: string) {
  const from = content.indexOf(needle);
  return { from, to: from };
}

describe('fixTableBlock', () => {
  it('เติมแถวคั่นให้ตารางที่ไม่มีแถวคั่นเลย', () => {
    const content = '| a | b |\n| 1 | 2 |';
    const result = fixTableBlock(content, cursorAt(content, '| a'));
    expect(result?.content).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |');
  });

  it('แก้แถวคั่นที่มีข้อความปน (กรณีผู้ใช้พิมพ์ผิด) — เก็บข้อความไว้เป็นแถวข้อมูล', () => {
    const content = '| Column 1 | Column 2 | Column 3 |\n| test | --- | --- |\n| a | b | c |';
    const result = fixTableBlock(content, cursorAt(content, '| test'));
    const lines = result!.content.split('\n');
    expect(lines[1]).toMatch(/^\|( -+ \|)+$/); // แถวคั่นถูกต้องถูกแทรกเป็นบรรทัดที่ 2
    expect(result!.content).toContain('test'); // ข้อมูลเดิมไม่หาย
    expect(lines).toHaveLength(4); // header + separator + 2 แถวข้อมูล
  });

  it('เติมเซลล์ที่ขาดให้ครบทุกแถว', () => {
    const content = '| a | b | c |\n| --- | --- |\n| 1 |';
    const result = fixTableBlock(content, cursorAt(content, '| 1'));
    const lines = result!.content.split('\n');
    for (const line of lines) {
      expect(line.split('|')).toHaveLength(5); // 3 คอลัมน์ = คั่นด้วย | 4 ตัว
    }
  });

  it('คง alignment (:---:) จากแถวคั่นเดิม', () => {
    const content = '| a | b |\n| :--- | ---: |\n| 1 | 2 |';
    const result = fixTableBlock(content, cursorAt(content, '| 1'));
    const separator = result!.content.split('\n')[1];
    expect(separator).toMatch(/\| :-+ \| -+: \|/);
  });

  it('header บรรทัดเดียวก็เติมแถวคั่นให้ได้', () => {
    const content = 'x\n\n| a | b |\n\ny';
    const result = fixTableBlock(content, cursorAt(content, '| a'));
    expect(result!.content).toContain('| a   | b   |\n| --- | --- |');
    expect(result!.content.startsWith('x\n\n')).toBe(true);
    expect(result!.content.endsWith('\n\ny')).toBe(true);
  });

  it('คืน null เมื่อ cursor ไม่ได้อยู่บนแถวตาราง', () => {
    const content = 'plain text\n| a | b |';
    expect(fixTableBlock(content, cursorAt(content, 'plain'))).toBeNull();
  });

  it('คืน null เมื่อบล็อกมีแต่แถวคั่น', () => {
    const content = '| --- | --- |';
    expect(fixTableBlock(content, cursorAt(content, '| ---'))).toBeNull();
  });

  it('เคารพ \\| ที่ escape ไว้ในเซลล์', () => {
    const content = '| a\\|b | c |\n| 1 | 2 |';
    const result = fixTableBlock(content, cursorAt(content, '| 1'));
    expect(result!.content).toContain('a\\|b');
    const lines = result!.content.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('รวมบล็อกตารางที่คั่นด้วยบรรทัดว่าง 1 บรรทัดเป็นตารางเดียว', () => {
    const content = '| a | b |\n| --- | --- |\n\n| 1 | 2 |\n| 3 | 4 |';
    const result = fixTableBlock(content, cursorAt(content, '| 1'));
    const lines = result!.content.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 แถวข้อมูล ไม่มีบรรทัดว่างเหลือ
    expect(lines[0]).toContain('a');
    expect(lines[1]).toMatch(/^\|( -+ \|)+$/);
    expect(lines[2]).toContain('1');
    expect(lines[3]).toContain('3');
  });

  it('รวมได้แม้ cursor อยู่ในบล็อกบน (ขยายลงข้ามบรรทัดว่าง)', () => {
    const content = '| a | b |\n\n| 1 | 2 |\n| 3 | 4 |';
    const result = fixTableBlock(content, cursorAt(content, '| a'));
    expect(result!.content.split('\n')).toHaveLength(4);
    expect(result!.content).not.toContain('\n\n');
  });

  it('ไม่รวมข้ามบรรทัดว่างมากกว่า 1 บรรทัด (ตั้งใจแยกตาราง)', () => {
    const content = '| a | b |\n| --- | --- |\n\n\n| 1 | 2 |\n| 3 | 4 |';
    const result = fixTableBlock(content, cursorAt(content, '| 1'));
    // บล็อกบนต้องไม่ถูกแตะ — ยังอยู่ครบพร้อมบรรทัดว่าง 2 บรรทัด
    expect(result!.content.startsWith('| a | b |\n| --- | --- |\n\n\n')).toBe(true);
  });

  it('วาง cursor ไว้ท้ายตารางหลังจัดรูปแบบ', () => {
    const content = '| a | b |\n| 1 | 2 |\n\nafter';
    const result = fixTableBlock(content, cursorAt(content, '| a'));
    const blockEnd = result!.content.indexOf('\n\nafter');
    expect(result!.selectionStart).toBe(blockEnd);
    expect(result!.selectionEnd).toBe(blockEnd);
  });
});
