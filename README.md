# PlainMark

Simple Markdown Note Editor: พิมพ์ง่ายเหมือน Notepad พร้อม Markdown Preview แบบเรียลไทม์

> **งานของคุณไม่มีวันหาย** — ทุกอย่างที่พิมพ์ถูกบันทึกอัตโนมัติเสมอ ปิดแอปด้วยกากบาทได้เลย เปิดใหม่ทุกอย่างยังอยู่เหมือนเดิม ทำงานแบบ offline 100%

## ดาวน์โหลดและติดตั้ง (Windows)

1. ไปที่หน้า [Releases](../../releases) ของ repo นี้
2. ดาวน์โหลด `PlainMark_x.x.x_x64-setup.exe` (แนะนำ) หรือ `PlainMark_x.x.x_x64_en-US.msi`
3. ดับเบิลคลิกติดตั้ง — ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ (ติดตั้งเฉพาะผู้ใช้ปัจจุบัน)

## ฟีเจอร์

- **Editor + Live Preview** — CodeMirror 6 + markdown-it + highlight.js (sanitize ด้วย DOMPurify)
- **Toolbar จัดรูปแบบ** — Heading, Bold, Italic, Table, Code Block, Link, Image, List ฯลฯ ไม่ต้องจำ syntax
- **กลุ่มโน้ต (แผงด้านขวา)** — โน้ตใหม่เข้ากลุ่มรายวันอัตโนมัติ หรือสร้างกลุ่มตั้งชื่อเอง เปลี่ยนชื่อ/ย้าย/ลบได้
  เก็บเป็นไฟล์ `.md` จริงใน `Documents\PlainMark\<ชื่อกลุ่ม>\` เปิดด้วยโปรแกรมอื่นหรือสำรองได้ทันที
- **Auto-save เสมอ** — เนื้อหา ไฟล์ที่เปิดค้าง และสถานะล่าสุดถูกบันทึกตลอด รวมถึงตอนกดปิดหน้าต่าง
- **วางรูปจากคลิปบอร์ด / ลากวาง** — ฝังเป็น base64 reference-style
- **Open / Save / Export** `.md` และ `.txt`
- **ธีม Light / Dark / System** — จำค่าที่ตั้งไว้ข้ามการเปิดแอป

## Build จากซอร์สโค้ด

ต้องมี:

- Node.js 20+
- Rust stable (ผ่าน [rustup](https://rustup.rs))
- [Tauri OS prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
git clone <URL ของ repo นี้>
cd PlainMark
npm ci
npm run tauri:build
```

ไฟล์ติดตั้งจะอยู่ที่:

- `src-tauri/target/release/bundle/nsis/PlainMark_x.x.x_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/PlainMark_x.x.x_x64_en-US.msi`

## Development

```bash
npm install
npm run tauri:dev   # เปิดแอป desktop โหมดพัฒนา
npm run dev         # เฉพาะ frontend ที่ http://127.0.0.1:1420
npm test            # รัน vitest
```

## Release ผ่าน GitHub Actions

push tag รูปแบบ `v*` (เช่น `v0.1.0`) → workflow `Release` จะ build ตัวติดตั้ง Windows และสร้าง draft release พร้อมไฟล์แนบให้อัตโนมัติ ตรวจแล้วกด Publish ได้เลย

## ที่เก็บข้อมูล

| ข้อมูล | ตำแหน่ง |
|---|---|
| โน้ตทั้งหมด | `Documents\PlainMark\` |
| session ล่าสุด (กันงานหาย) | `%APPDATA%\com.plainmark.app\session.json` |
| การตั้งค่า (ธีม/เลย์เอาต์) | localStorage ของแอป |
