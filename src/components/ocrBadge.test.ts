import { describe, expect, it } from 'vitest';
import { ocrBadge } from './MeetingsView';

describe('ocrBadge', () => {
  it('labels each OCR state of a region capture', () => {
    expect(ocrBadge({ kind: 'ocr', ocrStatus: 'pending' }).label).toBe('รออ่านข้อความ');
    expect(ocrBadge({ kind: 'ocr' }).label).toBe('รออ่านข้อความ');
    expect(ocrBadge({ kind: 'ocr', ocrStatus: 'done', ocrText: 'Q4' })).toEqual({
      label: 'อ่านแล้ว',
      tone: 'shareable'
    });
    expect(ocrBadge({ kind: 'ocr', ocrStatus: 'done', ocrText: '' }).label).toBe('ไม่พบข้อความ');
    expect(ocrBadge({ kind: 'ocr', ocrStatus: 'unavailable' }).label).toBe('ยังไม่ได้ติดตั้งตัวอ่าน');
    expect(ocrBadge({ kind: 'ocr', ocrStatus: 'failed' }).label).toBe('อ่านไม่สำเร็จ');
  });
});
