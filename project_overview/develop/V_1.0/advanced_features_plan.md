# แผนพัฒนา Advanced Features — v0.8.0

แผนนี้แตกงานจาก [advanced_features.md](advanced_features.md) เป็นขั้นตอนที่ลงมือทำได้จริง
เรียงตาม Development Priority ในเอกสารต้นทาง (MVP → MVP+ → Post-MVP)

## หลักการที่ยึดตลอดงาน

1. **Editor กับ Preview ต้องสอดคล้องกัน** — ทุกอย่างที่แทรก/แปลงในฝั่งเขียน ต้องแสดงผลถูกต้องในฝั่ง preview ด้วย
2. **ไฟล์ยังเป็น Markdown มาตรฐาน** — ฟีเจอร์ "ฉลาด" ทั้งหมดเกิดที่การแสดงผล ไม่แก้เนื้อหาต้นฉบับ (ยกเว้นผู้ใช้สั่งเอง เช่น paste)
3. **แยก logic ล้วนออกจาก UI** — กติกาแต่ละฟีเจอร์อยู่ใน `src/lib/*.ts` (ทดสอบด้วย vitest ได้) ส่วนต่อกับ CodeMirror อยู่ใน `src/components/editor/*.ts`

## โครงไฟล์ใหม่

```
src/lib/
  smartFormat.ts       กติกา auto-format (ต่อ list/quote, ย่อ [], ฯลฯ) — pure function
  slashCommands.ts     รายการคำสั่ง / + fuzzy filter — pure function
  pasteConvert.ts      HTML (Word/Excel/เว็บ) → Markdown ด้วย turndown + GFM
  contentCards.ts      จำแนก URL (YouTube/GitHub/PDF/Email) + markdown-it plugin สร้าง card
src/components/editor/
  smartFormatExtension.ts   keymap Enter/Backspace เรียก smartFormat
  slashMenu.ts              autocomplete ของ CodeMirror ผูกกับ slashCommands
  floatingToolbar.ts        tooltip ลอยเหนือข้อความที่เลือก (Bold/Italic/Link/Code/Heading)
  hoverPreview.ts           hoverTooltip แสดง preview เฉพาะ block ใต้เมาส์
```

## ขั้นตอนที่ 1 — Smart Auto-format (MVP)

**lib:** `continueListOnEnter(lineText)` คืนคำตอบว่า Enter แล้วควรเติมอะไร

- `1. …` → บรรทัดใหม่ขึ้นต้น `2. ` (เลขต่อเนื่อง)
- `- …` / `* …` → เติม `- ` / `* `
- `- [ ] …` / `- [x] …` → เติม `- [ ] ` (เช็คบ็อกซ์ใหม่ว่างเสมอ)
- `> …` → เติม `> `
- บรรทัดที่มีแต่ marker ว่างเปล่า → Enter = ลบ marker ออก (ออกจาก list)
- รองรับ indent นำหน้า (nested list)

**shorthand ขณะพิมพ์:** `[]` + เว้นวรรค ต้นบรรทัด → `- [ ] `

Link Detection ฝั่งแสดงผลมีอยู่แล้ว (markdown-it `linkify: true`) — พิมพ์ URL เปล่าๆ ใน preview เป็นลิงก์เสมอ

## ขั้นตอนที่ 2 — Paste Anything (MVP+)

ลำดับการตัดสินใจใน paste handler ของ EditorPane (ต่อจากของเดิม):

1. รูปภาพใน clipboard → base64 reference (มีแล้ว)
2. URL เปล่ายาว → reference link (มีแล้ว)
3. **ใหม่:** clipboard มี `text/html` (Word / Excel / เว็บ / Rich Text) → แปลงเป็น Markdown ด้วย turndown + turndown-plugin-gfm (ตารางจาก Excel → Markdown Table)
4. ข้อความธรรมดา → ปล่อยผ่านตามปกติ

Heuristic กัน over-convert: แปลงเฉพาะเมื่อ HTML มีโครงสร้างจริง (heading/list/table/ลิงก์/รูป/ตัวหนา) — ถ้าเป็นแค่ span ห่อข้อความล้วน ให้ใช้ text ธรรมดา

## ขั้นตอนที่ 3 — Slash Command (MVP+)

- พิมพ์ `/` ต้นบรรทัด (หรือหลังช่องว่าง) → เมนูคำสั่งโผล่ที่ cursor (ใช้ @codemirror/autocomplete)
- คำสั่ง: Heading 1–3, Bold, Italic, Table, Quote, Image, Code Block, Inline Code, Todo, Bullet List, Numbered List, Link, Horizontal Rule
- ค้นหาแบบ fuzzy ทั้งชื่ออังกฤษและคำไทย (เช่น `/tar` เจอ "ตาราง")
- เลือกแล้วลบ `/query` ทิ้ง แทรก Markdown ของคำสั่งนั้น พร้อมวาง cursor ตำแหน่งพิมพ์ต่อ

## ขั้นตอนที่ 4 — Floating Toolbar (Post-MVP)

- เลือกข้อความใน editor (ด้วยเมาส์/คีย์บอร์ด) → toolbar ลอยเหนือ selection
- ปุ่ม: **B**, *I*, Link, `Code`, H1 — ใช้ formatActions เดิม ผลลัพธ์เหมือนกด toolbar ข้าง
- ทำด้วย `showTooltip` ของ CodeMirror (ตำแหน่งเลื่อนตาม scroll อัตโนมัติ)

## ขั้นตอนที่ 5 — Hover Preview (Post-MVP)

- ชี้เมาส์ค้างบน Markdown ใน editor → tooltip แสดงผลจริงเฉพาะจุดนั้น
- รองรับ: Image (รวม reference-style/base64), Table, Link, Code fence, Quote
- ใช้ `hoverTooltip` + `renderMarkdown()` ตัวเดียวกับ preview หลัก → การแสดงผลตรงกันเสมอ

## ขั้นตอนที่ 6 — Auto Detect Content (Post-MVP)

markdown-it plugin `contentCards`: ย่อหน้าที่มีแค่ลิงก์เดียว → แปลงเป็น card ตอน render
(Markdown ต้นฉบับไม่ถูกแตะ ตามข้อกำหนดในเอกสาร)

| ชนิดลิงก์ | Card |
|---|---|
| YouTube (watch / youtu.be / shorts) | Video Card — thumbnail + ชื่อ + ปุ่ม play |
| GitHub repo (`github.com/owner/repo`) | Repository Card — icon + owner/repo |
| ลิงก์ `.pdf` | File Card — icon PDF + ชื่อไฟล์ |
| Email (`mailto:`) | Mail Card — icon จดหมาย + ที่อยู่ |

- รองรับทั้งลิงก์เปล่า (autolink) และ reference-style ที่แอปย่อให้ตอน paste
- ทั้ง card เป็น `<a>` เดียว คลิกเปิดตามปกติ; ผ่าน DOMPurify (ไม่มี script/iframe)
- Thumbnail YouTube โหลดจาก img.youtube.com — offline จะเห็น card แบบไม่มีรูป (ยังใช้งานได้)

## ขั้นตอนที่ 7 — เก็บงานปิดเวอร์ชัน

1. CSS ทุกฟีเจอร์ใหม่ใน app.css / preview.css (รองรับทั้ง light/dark)
2. vitest ครอบ lib ใหม่ทั้ง 4 ไฟล์ + ของเดิมต้องผ่านครบ
3. Bump 0.7.0 → 0.8.0 (package.json, Cargo.toml, tauri.conf.json)
4. อัปเดต README (ฟีเจอร์ + คีย์ลัด)
5. ตรวจสอบย้อนกับ advanced_features.md ทีละหัวข้อ
6. `npm run tauri:build` → วาง PlainMark-Setup.exe ที่ root → commit + push

## Dependencies ใหม่

- `@codemirror/autocomplete` — เมนู slash command
- `turndown` + `turndown-plugin-gfm` — HTML → Markdown (รวมตาราง GFM)
