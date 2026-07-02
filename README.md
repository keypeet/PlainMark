# PlainMark

Simple Markdown Note Editor: พิมพ์ง่ายเหมือน Notepad พร้อม Markdown Preview แบบเรียลไทม์

**เวอร์ชันล่าสุด: 0.7.0**

> **งานของคุณไม่มีวันหาย** — ทุกอย่างที่พิมพ์ถูกบันทึกอัตโนมัติเสมอ ปิดแอปด้วยกากบาทได้เลย เปิดใหม่ทุกอย่างยังอยู่เหมือนเดิม ทำงานแบบ offline 100%

## ดาวน์โหลดและติดตั้ง (Windows)

**ดาวน์โหลดตรงจาก repo:** [PlainMark-Setup.exe](PlainMark-Setup.exe) (อยู่ที่ root ของ repo — กด Download / Raw ได้เลย)

ดับเบิลคลิกติดตั้ง — ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ (ติดตั้งเฉพาะผู้ใช้ปัจจุบัน)

หรือไปที่หน้า [Releases](../../releases) เพื่อดาวน์โหลดแบบระบุเวอร์ชัน (`PlainMark_x.x.x_x64-setup.exe` หรือ `.msi`)

## ฟีเจอร์

- **Editor + Live Preview** — CodeMirror 6 + markdown-it + highlight.js (sanitize ด้วย DOMPurify)
- **Toolbar จัดรูปแบบ** — Heading, Bold, Italic, Table, Code Block, Link, Image, List ฯลฯ ไม่ต้องจำ syntax
- **กลุ่มโน้ต (แผงด้านขวา)** — โน้ตใหม่เข้ากลุ่มรายวันอัตโนมัติ หรือสร้างกลุ่มตั้งชื่อเอง เปลี่ยนชื่อ/ย้าย/ลบได้
  เก็บเป็นไฟล์ `.md` จริงใน `<โฟลเดอร์เก็บโน้ต>\<ชื่อกลุ่ม>\` เปิดด้วยโปรแกรมอื่นหรือสำรองได้ทันที
- **เลือกโฟลเดอร์เก็บโน้ตเองได้** — ค่าเริ่มต้นคือ `Documents\PlainMark` กดปุ่มโฟลเดอร์ท้ายแผงโน้ตเพื่อเปลี่ยน
  (เช่น เปลี่ยนเป็น `Downloads\MyNotes`) กลุ่มโน้ตจะถูกเก็บเป็น sub-folder ในโฟลเดอร์ที่เลือก
  พร้อมตัวเลือกย้ายโน้ตเดิมทั้งหมดไปที่ใหม่ให้อัตโนมัติ
- **Auto-save เสมอ** — เนื้อหา ไฟล์ที่เปิดค้าง และสถานะล่าสุดถูกบันทึกตลอด รวมถึงตอนกดปิดหน้าต่าง
- **วางรูปจากคลิปบอร์ด / ลากวาง** — ฝังเป็น base64 reference-style
- **Open / Save / Export** `.md` และ `.txt`
- **ซูมขยาย/ย่อทั้งแอป** — `Ctrl` + ลูกกลิ้งเมาส์, `Ctrl+=` / `Ctrl+-` / `Ctrl+0` (รีเซ็ต)
  หรือปุ่ม − / + ที่แถบสถานะด้านล่าง (50%–250% จำค่าไว้ข้ามการเปิดแอป)
- **ธีม Light / Dark / System** — จำค่าที่ตั้งไว้ข้ามการเปิดแอป
- **ปรับขนาดหน้าต่างได้อิสระ** — ย่อ/ขยาย/maximize ได้ (ขนาดต่ำสุด 760×520)

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

> **หมายเหตุถ้าโปรเจกต์อยู่ใน OneDrive:** OneDrive อาจ lock ไฟล์ระหว่าง cargo build ทำให้ build ล้มเหลว
> แก้โดยตั้ง `CARGO_TARGET_DIR` ชี้ออกนอก OneDrive เช่น
> `setx CARGO_TARGET_DIR "%LOCALAPPDATA%\plainmark-cargo-target"`
> (ไฟล์ bundle จะไปอยู่ใต้โฟลเดอร์นั้นแทน `src-tauri/target`)

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
| โน้ตทั้งหมด | `Documents\PlainMark\` (ค่าเริ่มต้น — เปลี่ยนได้จากปุ่มท้ายแผงโน้ต) |
| session ล่าสุด (กันงานหาย) | `%APPDATA%\com.plainmark.app\session.json` |
| การตั้งค่า (ธีม/เลย์เอาต์/โฟลเดอร์เก็บโน้ต/ซูม) | localStorage ของแอป |

## คีย์ลัด

| คีย์ | การทำงาน |
|---|---|
| `Ctrl+N` | ไฟล์ใหม่ |
| `Ctrl+O` | เปิดไฟล์ |
| `Ctrl+S` | บันทึก (โน้ตบันทึกออโต้อยู่แล้ว — เป็นการ flush ทันที) |
| `Ctrl+=` / `Ctrl+-` | ซูมเข้า / ซูมออก |
| `Ctrl+0` | รีเซ็ตซูม 100% |
| `Ctrl` + ลูกกลิ้งเมาส์ | ซูมเข้า/ออก |
