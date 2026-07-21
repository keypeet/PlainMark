import { describe, expect, it } from 'vitest';
import { lineDiffStats } from './diffStats';

describe('lineDiffStats', () => {
  it('เนื้อหาเหมือนเดิม = ไม่มีอะไรเปลี่ยน', () => {
    expect(lineDiffStats('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
  });

  it('เพิ่มบรรทัดต่อท้าย', () => {
    expect(lineDiffStats('a\nb', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
  });

  it('ลบบรรทัดออก', () => {
    expect(lineDiffStats('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 });
  });

  it('แก้ไขบรรทัดกลาง = นับเป็นลบของเก่า+เพิ่มของใหม่', () => {
    expect(lineDiffStats('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('จากว่าง = ทุกบรรทัดถูกนับเป็นเพิ่มใหม่ทั้งหมด', () => {
    expect(lineDiffStats('', 'a\nb')).toEqual({ added: 2, removed: 0 });
  });
});
