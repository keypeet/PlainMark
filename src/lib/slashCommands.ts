// Slash Command — รายการคำสั่ง "/" และ fuzzy filter (logic ล้วน — UI อยู่ใน components/editor/slashMenu.ts)
// ตาม advanced_features.md ข้อ 1: Heading, Table, Quote, Image, Code, Todo, Link + ค้นหาแบบ fuzzy

export interface SlashCommand {
  id: string;
  /** ชื่อที่แสดงในเมนู */
  label: string;
  /** คำอธิบายสั้น (ไทย) */
  detail: string;
  /** คำค้นเพิ่มเติมทั้งอังกฤษ/ไทย ให้ fuzzy search เจอง่าย */
  keywords: string[];
  /** Markdown ที่จะแทรก */
  insert: string;
  /** ตำแหน่ง cursor หลังแทรก (offset จากจุดเริ่ม insert) — ไม่ระบุ = ท้ายข้อความ */
  cursorOffset?: number;
}

export const slashCommands: SlashCommand[] = [
  { id: 'h1', label: 'Heading 1', detail: 'หัวข้อใหญ่', keywords: ['heading', 'h1', 'หัวข้อ', 'title'], insert: '# ' },
  { id: 'h2', label: 'Heading 2', detail: 'หัวข้อรอง', keywords: ['heading', 'h2', 'หัวข้อ'], insert: '## ' },
  { id: 'h3', label: 'Heading 3', detail: 'หัวข้อย่อย', keywords: ['heading', 'h3', 'หัวข้อ'], insert: '### ' },
  {
    id: 'table',
    label: 'Table',
    detail: 'ตาราง 2×2',
    keywords: ['table', 'ตาราง', 'grid'],
    insert: '| Column 1 | Column 2 |\n| --- | --- |\n|    |    |\n|    |    |\n',
    cursorOffset: 2
  },
  { id: 'quote', label: 'Quote', detail: 'ข้อความอ้างอิง', keywords: ['quote', 'blockquote', 'อ้างอิง', 'คำพูด'], insert: '> ' },
  {
    id: 'image',
    label: 'Image',
    detail: 'แทรกรูปภาพ',
    keywords: ['image', 'picture', 'photo', 'รูป', 'ภาพ'],
    insert: '![alt text](image.png)',
    cursorOffset: 2
  },
  {
    id: 'code',
    label: 'Code Block',
    detail: 'บล็อกโค้ด',
    keywords: ['code', 'codeblock', 'fence', 'โค้ด'],
    insert: '```txt\ncode\n```\n',
    cursorOffset: '```txt\n'.length
  },
  { id: 'inline-code', label: 'Inline Code', detail: 'โค้ดในบรรทัด', keywords: ['code', 'inline', 'โค้ด'], insert: '`code`', cursorOffset: 1 },
  { id: 'todo', label: 'Todo', detail: 'เช็คลิสต์', keywords: ['todo', 'task', 'checklist', 'checkbox', 'เช็คลิสต์', 'งาน'], insert: '- [ ] ' },
  { id: 'bullet', label: 'Bullet List', detail: 'ลิสต์จุดวงกลม', keywords: ['list', 'bullet', 'ul', 'ลิสต์', 'รายการ'], insert: '- ' },
  { id: 'numbered', label: 'Numbered List', detail: 'ลิสต์ตัวเลข', keywords: ['list', 'ordered', 'number', 'ol', 'ลิสต์', 'ตัวเลข'], insert: '1. ' },
  {
    id: 'link',
    label: 'Link',
    detail: 'แทรกลิงก์',
    keywords: ['link', 'url', 'ลิงก์'],
    insert: '[link text](https://)',
    cursorOffset: 1
  },
  { id: 'bold', label: 'Bold', detail: 'ตัวหนา', keywords: ['bold', 'strong', 'หนา'], insert: '**bold**', cursorOffset: 2 },
  { id: 'italic', label: 'Italic', detail: 'ตัวเอียง', keywords: ['italic', 'em', 'เอียง'], insert: '*italic*', cursorOffset: 1 },
  { id: 'hr', label: 'Divider', detail: 'เส้นคั่น', keywords: ['divider', 'horizontal', 'rule', 'hr', 'เส้น', 'คั่น'], insert: '\n---\n' }
];

/**
 * fuzzy match แบบเบา: ตัวอักษรของ query ต้องปรากฏเรียงลำดับใน target
 * เช่น "tbl" เจอ "table", "หข" เจอ "หัวข้อ"
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let index = 0;
  for (const char of q) {
    index = t.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

/** กรองคำสั่งตาม query (ว่าง = ทั้งหมด) — เช็คทั้ง label และ keywords */
export function filterSlashCommands(query: string): SlashCommand[] {
  if (!query) return slashCommands;
  return slashCommands.filter(
    (command) => fuzzyMatch(query, command.label) || command.keywords.some((keyword) => fuzzyMatch(query, keyword))
  );
}
