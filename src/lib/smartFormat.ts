// Smart Auto-format — กติกาช่วยเติม Markdown อัตโนมัติขณะพิมพ์ (logic ล้วน ไม่ผูกกับ editor)
//
// ครอบคลุมตาม advanced_features.md ข้อ 6:
//   Ordered List / Bullet List / Checklist / Quote → กด Enter แล้วต่อ marker ให้เอง
//   บรรทัดที่มีแต่ marker ว่าง → กด Enter = ออกจาก list (ลบ marker)
//   Heading / Horizontal Rule → เป็น Markdown มาตรฐานอยู่แล้ว ไม่ต้องช่วย
//   Link Detection → ฝั่ง preview เปิด linkify ไว้ (markdownEngine) URL เปล่ากลายเป็นลิงก์เสมอ

/** ผลของการกด Enter บนบรรทัด list/quote */
export type EnterAction =
  | { kind: 'continue'; marker: string } // ขึ้นบรรทัดใหม่พร้อม marker ถัดไป
  | { kind: 'exit' } // บรรทัดว่างมีแต่ marker → ลบ marker ทิ้ง (ออกจาก list)
  | { kind: 'none' }; // บรรทัดธรรมดา ปล่อยให้ Enter ทำงานปกติ

interface LinePattern {
  // จับ [indent, marker, เนื้อหาหลัง marker] — เรียงจากเจาะจงมาก → น้อย
  regexp: RegExp;
  nextMarker: (match: RegExpMatchArray) => string;
}

const linePatterns: LinePattern[] = [
  {
    // เช็คลิสต์: "- [ ] งาน" / "* [x] งาน" → บรรทัดใหม่เป็นช่องว่างเสมอ
    regexp: /^(\s*)([-*+] \[[ xX]\] )(.*)$/,
    nextMarker: (match) => `${match[1]}${match[2][0]} [ ] `
  },
  {
    // ordered list: "3. งาน" → บรรทัดใหม่ "4. "
    regexp: /^(\s*)(\d+)([.)] )(.*)$/,
    nextMarker: (match) => `${match[1]}${Number(match[2]) + 1}${match[3]}`
  },
  {
    // bullet list: "- งาน" / "* งาน" / "+ งาน"
    regexp: /^(\s*)([-*+] )(.*)$/,
    nextMarker: (match) => `${match[1]}${match[2]}`
  },
  {
    // quote: "> ข้อความ" (รวมซ้อน "> > ...")
    regexp: /^(\s*)((?:> ?)+)(.*)$/,
    nextMarker: (match) => `${match[1]}${match[2]}`
  }
];

/** ตัดสินว่ากด Enter ท้ายบรรทัดนี้แล้วควรทำอะไร */
export function enterActionForLine(lineText: string): EnterAction {
  for (const pattern of linePatterns) {
    const match = lineText.match(pattern.regexp);
    if (!match) continue;
    const body = match[match.length - 1];
    // มีแต่ marker ไม่มีเนื้อหา → ผู้ใช้ต้องการจบ list
    if (!body.trim()) return { kind: 'exit' };
    return { kind: 'continue', marker: pattern.nextMarker(match) };
  }
  return { kind: 'none' };
}

/**
 * Shorthand ขณะพิมพ์: เคาะ space แล้วขยายคีย์ลัดต้นบรรทัดเป็น Markdown เต็ม
 * คืน null ถ้าไม่เข้าเงื่อนไข (ให้ space ทำงานปกติ)
 */
export function expandShorthand(textBeforeCursor: string): { replaceFrom: number; insert: string } | null {
  // "[]" หรือ "[ ]" ต้นบรรทัด + space → "- [ ] "
  const checkbox = textBeforeCursor.match(/^(\s*)\[ ?\]$/);
  if (checkbox) {
    return { replaceFrom: checkbox[1].length, insert: '- [ ] ' };
  }
  return null;
}
