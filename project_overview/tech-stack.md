# Tech Stack — PlainMark

> เทคโนโลยีที่เลือกใช้ พร้อมเหตุผลและทางเลือกที่พิจารณา
> Platform หลัก: **Tauri** (เลือกโดยผู้ใช้) — desktop app ที่ไฟล์เล็ก เร็ว cross-platform

---

## 1. สรุปภาพรวม (Stack at a Glance)

| ชั้น | เทคโนโลยี | เวอร์ชันแนะนำ |
|---|---|---|
| **App shell / Desktop** | Tauri | 2.x |
| **Native core** | Rust | stable (1.77+) |
| **Frontend framework** | React + TypeScript | React 18, TS 5.x |
| **Build tool / Dev server** | Vite | 5.x |
| **Text editor component** | CodeMirror 6 | 6.x |
| **Markdown parser** | markdown-it | 14.x |
| **Code highlighting** | highlight.js | 11.x |
| **HTML sanitizer** | DOMPurify | 3.x |
| **State management** | Zustand | 4.x |
| **Styling** | CSS + CSS Variables (theming) | — |
| **File / Dialog** | Tauri Plugins (fs, dialog, opener) | v2 |
| **Unit/Component test** | Vitest + Testing Library | latest |
| **E2E test (optional)** | Tauri WebDriver / Playwright | latest |
| **Packaging** | Tauri Bundler (MSI/NSIS, dmg, AppImage/deb) | v2 |
| **CI/CD** | GitHub Actions | — |

---

## 2. เหตุผลของการเลือกแต่ละตัว

### 2.1 Tauri (App shell) ⭐ ตัวเลือกหลัก
**ทำไม:**
- **ไฟล์เล็กมาก** (~5–10 MB) เทียบกับ Electron (~80–150 MB) — ตรงเป้าหมาย NFR "installer < 15 MB"
- **ใช้ RAM น้อย** เพราะใช้ Webview ของระบบ ไม่ฝัง Chromium ทั้งตัว
- **เปิดเร็ว** — ตรงกับ UX "เปิดเร็วเหมือน Notepad"
- **Cross-platform** (Windows/macOS/Linux) จาก codebase เดียว
- **ปลอดภัย** — ระบบ permission/capability ที่จำกัด FS scope ได้ละเอียด
- เขียน UI ด้วย web tech ที่คุ้นเคย แต่ได้ native packaging + เข้าถึงไฟล์ระบบ

**ข้อควรระวัง:** Webview ต่างกันในแต่ละ OS (WebView2/WKWebView/WebKitGTK) → ต้องทดสอบทั้ง 3 OS และเลี่ยง CSS/JS feature ที่รองรับแคบ

### 2.2 React + TypeScript
**ทำไม:** ecosystem ใหญ่, type-safety ลด bug, เข้ากับ CodeMirror/Zustand ได้ดี, หาคนทำต่อง่าย
**ทางเลือกที่พิจารณา:** *Svelte* (เบากว่า bundle เล็กกว่า เหมาะกับปรัชญา Tauri) — เป็นทางเลือกที่ดีถ้าเน้น bundle ที่สุด; เลือก React เพราะความคุ้นเคยและ ecosystem ของ component/test กว้างกว่า

### 2.3 Vite
**ทำไม:** dev server เร็ว (HMR), config น้อย, เป็น frontend tool ที่ Tauri แนะนำและ integrate ง่าย

### 2.4 CodeMirror 6 (หัวใจฝั่ง Editor)
**ทำไม:**
- ออกแบบมาสำหรับ editor โดยเฉพาะ — รองรับ **line numbers, syntax highlight ใน editor, undo/redo, multi-cursor, การจัดการ selection** ที่จำเป็นต่อ formatActions
- โมดูลาร์/น้ำหนักเบา โหลดเฉพาะ extension ที่ใช้
- API จัดการ selection/transaction เหมาะกับปุ่ม Toolbar (wrap/insert/linePrefix)
- รองรับ IME/ภาษาไทยได้ดี
**ทางเลือกที่พิจารณา:**
- *textarea ธรรมดา* — ง่ายสุดแต่ไม่มี line number/highlight, จัดการ selection ยาก → ใช้แค่ใน prototype (`user-design.html`)
- *Monaco* — ทรงพลังแต่หนักเกินสำหรับ note app และ bundle ใหญ่
- *TipTap/ProseMirror (WYSIWYG)* — เป็น rich-text ไม่ใช่ text-first; ขัดกับปรัชญา "ไฟล์เป็น plain text"

### 2.5 markdown-it (Markdown → HTML)
**ทำไม:**
- เร็ว, เสถียร, **ปรับให้ใกล้ GitHub Flavored Markdown** ได้ (ตรงกับ NFR "rendering ใกล้ GitHub")
- ระบบ **plugin** ครบ (table, task list, footnote, emoji, container) → รองรับ Markdown Guide cheat sheet ทั้ง Basic และ Extended
- API ตรงไปตรงมา ใช้ร่วมกับ highlight.js + DOMPurify ได้สะดวก
**ทางเลือกที่พิจารณา:** *marked* (เบาแต่ plugin น้อยกว่า), *remark/unified* (ทรงพลัง/AST ดี แต่ setup ซับซ้อนเกินจำเป็นสำหรับ MVP)

### 2.6 highlight.js (Syntax highlight ใน code block)
**ทำไม:** ใช้ runtime ได้ทันที, รองรับภาษาเยอะ, integrate กับ markdown-it ง่าย, โหลดเฉพาะภาษาที่ใช้บ่อยเพื่อลด bundle
**ทางเลือกที่พิจารณา:** *Shiki* (สวย/แม่นระดับ VS Code แต่หนักกว่าและต้องโหลด theme/grammar) — พิจารณาใน post-MVP ถ้าต้องการคุณภาพสูงสุด

### 2.7 DOMPurify (Security)
**ทำไม:** กัน XSS จาก HTML/script ที่อาจฝังใน Markdown — **บังคับใช้** ตาม FR-11; เป็นมาตรฐานอุตสาหกรรม เร็ว เชื่อถือได้

### 2.8 Zustand (State)
**ทำไม:** เล็ก, boilerplate น้อย, เหมาะกับ state ระดับนี้ (doc/settings) โดยไม่ over-engineer
**ทางเลือกที่พิจารณา:** *Redux* (มากเกินไป), *React Context ล้วน* (re-render กว้างเกินสำหรับ state ที่อัปเดตถี่)

### 2.9 CSS + CSS Variables (Styling/Theming)
**ทำไม:** เบา ไม่เพิ่ม dependency, ทำ Light/Dark theme ด้วย custom properties ได้สะอาด สอดคล้องปรัชญา Tauri (bundle เล็ก)
**ทางเลือกที่พิจารณา:** *Tailwind* (เร็วต่อการพัฒนา แต่เพิ่ม toolchain) — เป็นทางเลือกได้ถ้าทีมถนัด

### 2.10 Tauri Plugins (fs / dialog / opener)
**ทำไม:** จัดการ open/save/export + dialog เลือกไฟล์แบบ native โดยจำกัด permission ตาม capability — ปลอดภัยและเป็น pattern มาตรฐานของ Tauri v2

### 2.11 Testing: Vitest + Testing Library (+ Rust tests)
**ทำไม:** Vitest เร็วและเข้ากับ Vite; ทดสอบ `formatActions`, `markdownEngine`, component หลัก; ฝั่ง Rust ใช้ `cargo test` กับ command; E2E ด้วย Tauri WebDriver/Playwright (optional)

---

## 3. Dependency Overview (ตัวอย่าง)

```jsonc
// package.json (frontend) — ย่อ
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "codemirror": "^6",
    "@codemirror/lang-markdown": "^6",
    "@codemirror/view": "^6",
    "@codemirror/state": "^6",
    "markdown-it": "^14",
    "highlight.js": "^11",
    "dompurify": "^3",
    "zustand": "^4"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "^5",
    "vite": "^5",
    "@vitejs/plugin-react": "^4",
    "vitest": "latest",
    "@testing-library/react": "latest"
  }
}
```

```toml
# src-tauri/Cargo.toml — ย่อ
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

---

## 4. ความต้องการสภาพแวดล้อมพัฒนา (Dev Prerequisites)

| เครื่องมือ | หมายเหตุ |
|---|---|
| Node.js 18+ และ npm/pnpm | สำหรับ frontend |
| Rust (rustup, stable) | สำหรับ Tauri core |
| **Windows:** Microsoft C++ Build Tools + WebView2 Runtime | Tauri build บน Windows |
| **macOS:** Xcode Command Line Tools | Tauri build บน macOS |
| **Linux:** webkit2gtk, build-essential ฯลฯ | Tauri build บน Linux |

**คำสั่งหลัก**
```bash
npm install            # ติดตั้ง dependencies
npm run tauri dev      # รัน dev (hot reload)
npm run tauri build    # build installer สำหรับ OS ปัจจุบัน
npm test               # รัน unit tests
```

---

## 5. กลยุทธ์การ Build & Distribution

- **Windows:** `.msi` (WiX) หรือ `.exe` (NSIS) — แนะนำ NSIS สำหรับไฟล์เล็ก/ติดตั้งง่าย
- **macOS:** `.dmg` / `.app` (แนะนำ sign + notarize ก่อนแจกจริง)
- **Linux:** `.AppImage` และ `.deb`
- **ผ่าน Git:** ผู้ใช้ `clone` แล้ว `npm install && npm run tauri build` ได้เอง (ตรง requirement "ติดตั้งหรือใช้งานผ่าน Git")
- **CI:** GitHub Actions matrix (windows/macos/ubuntu) build + แนบ artifact ใน Release

---

## 6. สรุปการตัดสินใจสำคัญ (Decision Log)

| การตัดสินใจ | เลือก | เหตุผลสั้น |
|---|---|---|
| Desktop shell | **Tauri** | เบา/เร็ว/ปลอดภัย/cross-platform (ผู้ใช้เลือก) |
| UI framework | **React + TS** | ecosystem + type safety (Svelte เป็น alt ที่ดี) |
| Editor | **CodeMirror 6** | text-first + จัดการ selection ดี เหมาะ Toolbar |
| Markdown | **markdown-it** | เร็ว + plugin ครบ + GFM-like |
| Highlight | **highlight.js** | เบา runtime, ภาษาเยอะ |
| Security | **DOMPurify** | บังคับ sanitize กัน XSS |
| State | **Zustand** | เล็ก เหมาะกับขนาด state |
| Style | **CSS variables** | bundle เล็ก, theming สะอาด |
