# PRD — PlainMark

> **Simple Markdown Note Editor** — แอปจดบันทึกแบบ Text-first พร้อม Markdown Preview แบบเรียลไทม์

| | |
|---|---|
| **ชื่อผลิตภัณฑ์** | PlainMark |
| **เวอร์ชันเอกสาร** | 1.0 |
| **วันที่** | 2026-06-17 |
| **สถานะ** | Draft — รออนุมัติ |
| **Platform** | Desktop (Windows / macOS / Linux) ด้วย Tauri |
| **เอกสารอ้างอิง** | `Requirement_PlainMark.md`, [Markdown Guide Cheat Sheet](https://www.markdownguide.org/cheat-sheet/) |

---

## 1. ภาพรวม (Overview)

PlainMark คือแอปจดบันทึกบนเดสก์ท็อปที่ให้ความรู้สึก **"พิมพ์ง่ายเหมือน Notepad"** แต่แสดงผลออกมาเป็น **Markdown ที่จัดหน้าสวยงามแบบเรียลไทม์** ผู้ใช้พิมพ์ข้อความธรรมดาในฝั่งซ้าย และเห็นผลลัพธ์ที่จัดรูปแบบแล้วในฝั่งขวาทันที โดยไม่จำเป็นต้องจำ Markdown syntax เพราะมีแถบเครื่องมือ (Toolbar) ช่วยแทรกรูปแบบให้

แนวคิดหลักคือ **Text-first**: ไฟล์ที่ได้ยังคงเป็นข้อความล้วน (`.txt` / `.md`) ที่เปิดด้วยโปรแกรมอะไรก็ได้ ไม่ผูกติดกับ format เฉพาะ (ไม่เหมือน `.docx`)

---

## 2. ปัญหาที่ต้องการแก้ (Problem Statement)

1. ผู้ใช้จำนวนมากจดบันทึกด้วย `.txt` ใน Notepad เพราะ **เปิดเร็ว พิมพ์ได้ทันที ไม่มีพิธีรีตอง**
2. แต่ผลลัพธ์ของ `.txt` ดู **ไม่เป็นระเบียบ** ไม่มีหัวข้อ ตัวหนา ตาราง รูปภาพ หรือโค้ดบล็อก
3. Markdown ให้ผลลัพธ์ที่เป็นระเบียบและสวยงาม แต่ผู้ใช้ **ไม่ถนัด/ไม่อยากจำ syntax** เช่น `###`, `|---|`, ` ``` `
4. เครื่องมือ Markdown editor ส่วนใหญ่ **ตั้งสมมติฐานว่าผู้ใช้รู้ syntax อยู่แล้ว** ทำให้คนทั่วไปเข้าไม่ถึง

> **ช่องว่างที่ PlainMark เติมเต็ม:** ความง่ายของ Notepad + ความสวยงามของ Markdown + ตัวช่วยที่ทำให้ไม่ต้องจำ syntax

---

## 3. เป้าหมาย & ตัวชี้วัด (Goals & Success Metrics)

### 3.1 เป้าหมายผลิตภัณฑ์
- **G1** ให้ผู้ใช้พิมพ์บันทึกได้ทันทีเหมือน Notepad (เปิดแอป → พิมพ์ได้เลย ไม่มีขั้นตอนตั้งค่า)
- **G2** แสดง Markdown Preview แบบเรียลไทม์ที่ลื่นไหล
- **G3** ลดอุปสรรคเรื่อง syntax ด้วย Toolbar/ปุ่มลัด เพื่อให้ "ไม่ต้องจำ Markdown"
- **G4** ส่งออกไฟล์เป็น `.txt` และ `.md` ได้อย่างน้อย 2 รูปแบบ
- **G5** เป็นแอปเบา ติดตั้งง่าย หรือ clone จาก Git แล้ว build/run ได้

### 3.2 Success Metrics (สำหรับ MVP)
| Metric | เป้าหมาย |
|---|---|
| Time-to-first-keystroke (เปิดแอปจนพิมพ์ได้) | < 1.5 วินาที |
| Preview latency (พิมพ์ → เห็น preview อัปเดต) | < 50 ms สำหรับเอกสาร < 5,000 คำ |
| ขนาดไฟล์ติดตั้ง (Windows installer) | < 15 MB |
| RAM ขณะใช้งานปกติ | < 200 MB |
| ครอบคลุม Markdown elements ตาม cheat sheet | 100% ของ Basic + ส่วนใหญ่ของ Extended |
| ผู้ใช้สามารถจัดรูปแบบ heading/bold/list ได้โดยไม่พิมพ์ syntax | ✅ ทำได้ผ่าน Toolbar/shortcut |

---

## 4. กลุ่มผู้ใช้เป้าหมาย (Target Users & Personas)

### Persona A — "นัท" นักจดบันทึกสาย Notepad
- ใช้ Notepad จด to-do, ไอเดีย, ข้อมูลชั่วคราวทุกวัน
- ชอบความเร็ว ไม่ชอบโปรแกรมที่โหลดนาน
- อยากให้โน้ตดูเป็นระเบียบขึ้น แต่ไม่อยากเรียน Markdown
- **ต้องการ:** เปิดเร็ว, พิมพ์เลย, มีปุ่มช่วยจัดหัวข้อ/ตัวหนา

### Persona B — "มายด์" คนเขียนคู่มือ/เอกสารสั้น
- เขียน README, คู่มือเล็กๆ, บันทึกการประชุม
- ต้องใช้ตาราง, โค้ดบล็อก, รูปภาพ, ลิงก์
- อยาก export เป็น `.md` ไปใช้ต่อใน Git/Wiki
- **ต้องการ:** Toolbar ครบ, preview ตรงกับที่ GitHub แสดง, export `.md`

### Persona C — "เอก" สาย Markdown มือใหม่
- รู้ว่า Markdown ดี อยากเริ่มใช้ แต่ยังจำ syntax ไม่ได้
- **ต้องการ:** เห็นว่าปุ่มแต่ละอันแทรก syntax อะไร (เรียนรู้ไปในตัว)

---

## 5. ขอบเขต (Scope)

### 5.1 In Scope (MVP)
- หน้าจอ Editor แบบ split view: ฝั่งพิมพ์ (ซ้าย) + ฝั่ง Preview (ขวา)
- Markdown Preview แบบเรียลไทม์
- Toolbar สำหรับแทรก/ครอบรูปแบบ Markdown (รายละเอียดในข้อ 6)
- รองรับ Markdown elements ตาม Markdown Guide Cheat Sheet
- New / Open / Save / Save As (ไฟล์ `.md`, `.txt`)
- Export เป็น `.txt` และ `.md`
- Keyboard shortcuts สำหรับรูปแบบยอดนิยม
- Light / Dark theme
- Auto-save แบบ local (กันข้อมูลหายเมื่อปิดแอป)

### 5.2 Out of Scope (MVP — พิจารณาในอนาคต)
- การ sync ผ่าน cloud / บัญชีผู้ใช้
- Real-time collaboration หลายคนพร้อมกัน
- Export เป็น `.pdf` / `.html` / `.docx` (อยู่ใน roadmap)
- ระบบ plugin / extension
- Mobile app (iOS / Android)
- การจัดการหลายไฟล์แบบ folder tree / workspace เต็มรูปแบบ (MVP มีแค่ tab/ไฟล์เดียวก็พอ)
- การจัดการ asset รูปขั้นสูง (แยกรูปออกเป็นไฟล์/โฟลเดอร์, optimize/บีบอัด, แกลเลอรี) — MVP รองรับการ **วาง/ฝัง base64** เท่านั้น (ดู FR-31)

---

## 6. ความต้องการเชิงฟังก์ชัน (Functional Requirements)

### 6.1 Editor (พิมพ์ข้อความ)
| ID | ความต้องการ | Priority |
|---|---|---|
| FR-1 | แสดงพื้นที่พิมพ์ข้อความล้วน รองรับภาษาไทย/อังกฤษ พิมพ์ได้ทันทีเมื่อเปิดแอป | Must |
| FR-2 | รองรับ undo/redo, copy/cut/paste, select all มาตรฐาน | Must |
| FR-3 | แสดงเลขบรรทัด (line number) เปิด/ปิดได้ | Should |
| FR-4 | ไฮไลต์ syntax เบาๆ ในฝั่ง editor (เช่น `#`, `**`) เพื่อช่วยอ่าน | Should |
| FR-5 | รองรับ Tab/Shift+Tab สำหรับ indent ใน list | Should |
| FR-6 | นับจำนวนคำ/ตัวอักษรใน status bar | Could |

### 6.2 Markdown Preview
| ID | ความต้องการ | Priority |
|---|---|---|
| FR-7 | แสดง Preview ที่ render จากข้อความ แบบเรียลไทม์ (debounce ≤ 50 ms) | Must |
| FR-8 | Preview scroll สอดคล้องกับตำแหน่ง cursor/ฝั่ง editor (sync scroll) | Should |
| FR-9 | Code block มี syntax highlighting | Should |
| FR-10 | สลับ layout ได้: Split / Editor-only / Preview-only | Should |
| FR-11 | Sanitize HTML ใน preview เพื่อความปลอดภัย (กัน XSS) | Must |

### 6.3 Toolbar / ตัวช่วยจัดรูปแบบ (หัวใจของผลิตภัณฑ์)
แถบเครื่องมือด้านขวา (หรือด้านบน) สำหรับแทรก/ครอบรูปแบบ Markdown โดย **ผู้ใช้ไม่ต้องพิมพ์ syntax เอง** — เมื่อกดปุ่ม ระบบจะแทรก syntax ที่ตำแหน่ง cursor หรือครอบข้อความที่เลือกไว้

| ID | ปุ่ม | พฤติกรรม | Markdown ที่แทรก | Shortcut |
|---|---|---|---|---|
| FR-12 | Heading | เลือก H1–H6 / วนระดับ | `# … ###### ` | `Ctrl+1..6` |
| FR-13 | Bold | ครอบ selection | `**text**` | `Ctrl+B` |
| FR-14 | Italic | ครอบ selection | `*text*` | `Ctrl+I` |
| FR-15 | Table | แทรก template ตาราง | `\| Col \| Col \|` … | `Ctrl+Shift+T` |
| FR-16 | Fenced Code Block | ครอบ/แทรก block | ` ```lang … ``` ` | `Ctrl+Shift+C` |
| FR-17 | Inline Code | ครอบ selection | `` `code` `` | `Ctrl+E` |
| FR-18 | Image | แทรก/เปิด dialog เลือกไฟล์ **หรือก็อปรูปแล้ววางได้ทันที (ดู FR-31)** | `![alt](path)` | `Ctrl+Shift+I` |
| FR-19 | Link | ครอบ selection / dialog | `[text](url)` | `Ctrl+K` |
| FR-20 | List | Bullet / Numbered / Task | `- `, `1. `, `- [ ] ` | `Ctrl+Shift+L` |
| FR-21 | Quote | ครอบบรรทัด | `> ` | `Ctrl+Shift+Q` |
| FR-22 | Horizontal Rule | แทรกเส้นคั่น | `---` | `Ctrl+Shift+H` |

> **พฤติกรรมสำคัญ:** ถ้ามีการเลือกข้อความอยู่ → ปุ่มจะ "ครอบ" ข้อความนั้น; ถ้าไม่มี → แทรก placeholder แล้ววาง cursor ให้พิมพ์ต่อทันที (เช่นกด Bold ได้ `**|**`)

| ID | ความต้องการเพิ่มเติมของ Toolbar | Priority |
|---|---|---|
| FR-30 | **Tooltip แสดงตัวอย่างผลลัพธ์ (preview):** เมื่อ hover/focus ปุ่มใดๆ ต้องแสดงป๊อปอัปที่บอก (ก) ชื่อปุ่ม (ข) **ตัวอย่างผลลัพธ์ที่ render แล้วว่าหน้าตาจะเป็นอย่างไร** (ค) Markdown syntax ที่จะแทรก และ (ง) shortcut — เพื่อให้ผู้ใช้ที่ไม่รู้/ลืมว่าปุ่มทำอะไร เห็นตัวอย่างก่อนกด | Must |

### 6.3.1 การแทรกรูปภาพแบบวาง (Image Paste — เพิ่มตามคำขอผู้ใช้)
| ID | ความต้องการ | Priority |
|---|---|---|
| FR-31 | **วางรูปจาก clipboard ได้ทันที:** ก็อปรูปจากที่อื่น (เว็บ, แคปหน้าจอ, โปรแกรมอื่น) แล้วกด `Ctrl+V` ในช่อง editor → ระบบฝังรูปเป็น **base64 data URL** ลงในเอกสารทันที **โดยไม่ต้องบันทึกไฟล์รูปก่อน** | Must |
| FR-32 | **ลากรูปวาง (drag & drop):** ลากไฟล์รูปจาก File Explorer มาวางในช่อง editor → ฝังเป็น base64 เช่นเดียวกัน (แสดง drop zone ระหว่างลาก) | Should |
| FR-33 | รูปที่วาง/ลากให้เก็บแบบ **reference-style** (`![alt][imgN]` + `[imgN]: data:...`) เพื่อให้ตัวข้อความใน editor ยังอ่านง่าย ไม่มี base64 ยาวๆ คั่นกลาง | Should |

### 6.4 File & Export
| ID | ความต้องการ | Priority |
|---|---|---|
| FR-23 | New — สร้างเอกสารใหม่ | Must |
| FR-24 | Open — เปิดไฟล์ `.md` / `.txt` จากเครื่อง | Must |
| FR-25 | Save / Save As — บันทึกไฟล์ | Must |
| FR-26 | Export `.md` — ส่งออกเนื้อหา Markdown ดิบ | Must |
| FR-27 | Export `.txt` — ส่งออกเป็นข้อความล้วน | Must |
| FR-28 | แจ้งเตือนเมื่อมีการแก้ไขที่ยังไม่บันทึก (dirty state) ก่อนปิด/เปิดไฟล์ใหม่ | Should |
| FR-29 | จำไฟล์ล่าสุดที่เปิด (Recent files) | Could |

### 6.5 Markdown Support Matrix (อ้างอิง Markdown Guide Cheat Sheet)
| กลุ่ม | Element | รองรับ MVP |
|---|---|---|
| **Basic** | Headings (H1–H6) | ✅ |
| | Bold / Italic / Bold+Italic | ✅ |
| | Blockquote (รวมซ้อน) | ✅ |
| | Ordered / Unordered List (รวมซ้อน) | ✅ |
| | Code (inline) | ✅ |
| | Horizontal Rule | ✅ |
| | Link / Image | ✅ |
| **Extended** | Table | ✅ |
| | Fenced Code Block + syntax highlight | ✅ |
| | Task List `- [ ]` / `- [x]` | ✅ |
| | Strikethrough `~~text~~` | ✅ |
| | Footnote | ⏳ (Should) |
| | Definition List | ⏳ (Could) |
| | Heading ID / Emoji / Highlight | ⏳ (Could) |

---

## 7. ความต้องการที่ไม่ใช่ฟังก์ชัน (Non-Functional Requirements)

| ด้าน | ข้อกำหนด |
|---|---|
| **Performance** | เปิดแอป < 1.5s; preview update < 50ms (เอกสาร < 5,000 คำ); ไม่กระตุกขณะพิมพ์ |
| **Footprint** | Installer < 15 MB; RAM < 200 MB ขณะใช้งานปกติ |
| **Cross-platform** | รองรับ Windows 10+, macOS 12+, Linux (deb/AppImage) |
| **Usability** | ใช้ได้ทันทีโดยไม่ต้องอ่านคู่มือ; ทุกปุ่มมี tooltip + แสดง shortcut |
| **Accessibility** | คีย์บอร์ดเข้าถึงทุกฟังก์ชัน; contrast ผ่าน WCAG AA; รองรับ font scaling |
| **Reliability** | Auto-save ทุก ~2s; กู้คืนเนื้อหาเมื่อแอป crash/ปิดกะทันหัน |
| **Security** | Preview HTML ถูก sanitize; Tauri capability/permission จำกัดเฉพาะที่จำเป็น (fs, dialog) |
| **Privacy** | ทำงาน offline 100%; ไม่ส่งข้อมูลออกนอกเครื่อง; ไม่มี telemetry โดยไม่ยินยอม |
| **i18n** | UI รองรับไทย/อังกฤษ; รองรับการพิมพ์/แสดงผล Unicode เต็มรูปแบบ |
| **Maintainability** | โค้ดแยก module ชัดเจน; มี test ครอบคลุม logic หลัก |

---

## 8. ข้อจำกัด & สมมติฐาน (Constraints & Assumptions)

- **Platform:** สร้างด้วย **Tauri** (Webview + Rust core) → ไฟล์เล็ก, cross-platform, เข้าถึงไฟล์ระบบได้ (ดู `tech-stack.md`)
- ใช้งานแบบ offline-first ไม่ต้องล็อกอิน
- เอกสารส่วนใหญ่มีขนาดเล็ก–กลาง (โน้ต/คู่มือสั้น) — ไม่ optimize สำหรับไฟล์หลักหมื่นบรรทัดใน MVP
- รูปภาพรองรับ 2 แบบใน MVP: (1) อ้างอิงด้วย path/URL และ (2) **วาง/ลากแล้วฝังเป็น base64** (FR-31..33) — รูปที่ฝังจะทำให้ขนาดไฟล์ `.md` ใหญ่ขึ้น ซึ่งเป็น trade-off ที่ยอมรับได้สำหรับโน้ต/เอกสารสั้น
- ผู้ใช้สามารถติดตั้งผ่าน installer หรือ clone จาก Git แล้ว build เองได้

---

## 9. ความเสี่ยง (Risks)
| ความเสี่ยง | ผลกระทบ | การรับมือ |
|---|---|---|
| Preview ช้าเมื่อเอกสารใหญ่ | UX แย่ | debounce + incremental render + virtualization (ภายหลัง) |
| Markdown rendering ไม่ตรงกับ GitHub | ผู้ใช้สับสน | ใช้ parser ที่ config ให้ใกล้ GFM (markdown-it + plugins) |
| ความแตกต่างของ Webview ข้าม OS | บั๊กเฉพาะแพลตฟอร์ม | ทดสอบทั้ง 3 OS; ใช้ CSS reset/feature ที่รองรับกว้าง |
| ช่องโหว่ XSS จาก HTML ใน Markdown | ความปลอดภัย | DOMPurify sanitize ก่อน render เสมอ |

---

## 10. ก้าวต่อไป (Future Roadmap — Post-MVP)
- Export `.pdf` / `.html` (ฝัง CSS) / `.docx`
- จัดการ asset รูปขั้นสูง (แยกรูปเป็นไฟล์อัตโนมัติ, optimize/บีบอัด base64, แกลเลอรีรูป)
- หลายแท็บ / workspace + file tree
- ธีม preview แบบกำหนดเอง (custom CSS)
- Outline / Table of Contents panel
- ค้นหา & แทนที่ (Find & Replace)
- Cloud sync (optional, opt-in)

---

## 11. เกณฑ์การยอมรับ (Acceptance Criteria สำหรับ MVP)
- [ ] เปิดแอปแล้วพิมพ์ได้ทันที เห็น preview อัปเดตเรียลไทม์
- [ ] ปุ่ม Toolbar ทั้ง 11 กลุ่ม (ข้อ 6.3) ทำงานถูกต้องทั้งกรณีมี/ไม่มี selection
- [ ] hover/focus ปุ่ม Toolbar แล้วเห็น tooltip ตัวอย่างผลลัพธ์ + syntax + shortcut (FR-30)
- [ ] ก็อปรูปแล้ว `Ctrl+V` วางในช่อง editor → ฝังเป็น base64 และแสดงใน preview ได้ (FR-31); ลากวางก็ได้ (FR-32)
- [ ] รองรับ Markdown elements ตามตารางข้อ 6.5 (Basic 100%)
- [ ] Open/Save/Save As ไฟล์ `.md` และ `.txt` ได้
- [ ] Export `.md` และ `.txt` ได้
- [ ] มี Light/Dark theme และ keyboard shortcuts ตามที่ระบุ
- [ ] Auto-save และกู้คืนเมื่อปิดกะทันหันได้
- [ ] ผ่านเกณฑ์ performance/footprint ในข้อ 3.2 และ 7
