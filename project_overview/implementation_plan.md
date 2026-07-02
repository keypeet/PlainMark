# แผนงาน PlainMark — ปรับเป็นแอปจริง ติดตั้งได้ + Auto-save แบบ Notepad + แผงจัดกลุ่มโน้ต

> วันที่จัดทำ: 2026-07-02

## บริบท (Context)

PlainMark เป็นแอป Markdown editor แบบ desktop (Tauri 2 + React 18 + TypeScript + CodeMirror 6 + markdown-it) ฟีเจอร์หลักตาม MVP เขียนเสร็จแล้ว (editor, live preview, toolbar 12 ปุ่ม, open/save/export, วางรูปเป็น base64, ธีม) แต่ยังไม่พร้อมเป็น "แอปจริง" เพราะ:

1. **Auto-save มีช่องโหว่** — บันทึก draft ลง localStorage เฉพาะตอน dirty ด้วย debounce 2 วินาที และ**ไม่มี handler ตอนปิดหน้าต่างเลย** → พิมพ์แล้วกด X ภายใน 2 วิ งานหายทันที อีกทั้งตอนเปิดใหม่มี dialog ถามก่อนกู้คืน (ไม่เหมือน Notepad ที่คืนให้เงียบๆ เสมอ)
2. **ยังไม่มีระบบจัดกลุ่มโน้ต** — เปิดได้ทีละไฟล์ ไม่มีที่รวมโน้ตให้ค้นหา/แยกเรื่องได้ง่าย
3. **Build installer ไม่ผ่าน** — `tauri.conf.json` มี `bundle.icon: []` และไม่มีโฟลเดอร์ `src-tauri/icons/` → `tauri build` fail แน่นอน
4. **Repo ยังไม่มีจริง** — โฟลเดอร์ `.git` ว่างเปล่า (0 ไฟล์) ไม่เคย init/commit และเครื่องไม่มี git ใน PATH (มีแต่ git ฝังใน GitHub Desktop)
5. **Settings ไม่ persist** — ธีม/layout/recent files รีเซ็ตทุกครั้งที่เปิดแอป
6. **บั๊ก CSP production** — `connect-src` ใน CSP ไม่มี `ipc: http://ipc.localhost` → แอปที่ติดตั้งจริง (ไม่ใช่ dev) จะเรียก dialog/fs ไม่ได้เลย

**หลักการเหนือทุกอย่าง (ตามที่ผู้ใช้ย้ำ):** ทุกสิ่งที่เขียน — จะกดบันทึกหรือไม่ก็ตาม — ต้อง**ไม่หายเด็ดขาด** ถูกบันทึกออโต้เสมอ และทำงานได้แบบ offline 100% (ทุกอย่างเก็บ local ในเครื่อง ไม่พึ่งอินเทอร์เน็ต)

## การตัดสินใจ

- Git: เตรียม local repo + commit + GitHub Actions ให้ครบ แล้วผู้ใช้กด **Publish repository** เองผ่าน GitHub Desktop
- ไอคอน: **สร้างให้อัตโนมัติ** (โลโก้ตัว P, PNG 1024px → `npx tauri icon`)
- เวอร์ชัน: **คงไว้ที่ 0.1.0**
- ที่เก็บโน้ต: **`Documents\PlainMark`** เป็นไฟล์ `.md` จริง แยกโฟลเดอร์ตามกลุ่ม (มองเห็น/สำรอง/ย้ายเครื่องได้ง่าย)
- กลุ่มรายวัน: โน้ตใหม่**เข้ากลุ่มวันนี้อัตโนมัติ** (เช่น `2026-07-02`) เปลี่ยนชื่อ/ย้ายกลุ่มภายหลังได้

---

## ส่วนที่ 1 — Auto-save/Session แบบ Notepad (สำคัญที่สุด)

**สถาปัตยกรรม:** เปลี่ยนจาก localStorage เป็น**ไฟล์ session ใน AppData** (`%APPDATA%\com.plainmark.app\session.json`) ผ่าน `@tauri-apps/plugin-fs` เหตุผล: draft มีรูป base64 ฝังได้ → localStorage มีโควตา ~5-10MB จะ `QuotaExceededError` เงียบๆ ส่วนไฟล์ไม่มีขีดจำกัด และทนกว่าการล้างข้อมูล WebView2 (คง localStorage ไว้เป็น fallback เฉพาะโหมด browser/dev ตาม pattern `hasTauri` ที่มีอยู่แล้วใน `src/lib/fileService.ts`)

### 1.1 สร้าง `src/lib/session.ts` (แทนที่ `src/lib/autosave.ts` — ลบไฟล์เดิม)

- `SessionState = { content, filePath, fileName, dirty, notePath, updatedAt }` (`notePath` บอกว่าเปิดโน้ตในระบบกลุ่มอยู่)
- `saveSession()` — เขียนแบบ serialize ด้วย promise chain + latest-wins snapshot (เรียกถี่ได้ ไม่เขียนซ้อน), เขียนเป็น `.tmp` แล้ว `rename` (atomic-ish), `mkdir(recursive)` ก่อน
- `flushSession()` — คืน promise chain ให้ close handler await ได้
- `loadSession()` — อ่านไฟล์ session; ถ้าไม่มี ให้ migrate จาก key เก่า `plainmark:draft` ใน localStorage (ครั้งเดียว, ตั้ง dirty=true)
- `clearSession()` — สำหรับเทสต์

### 1.2 `src/store/docStore.ts` — เพิ่ม action `hydrate(session)`

ตั้ง content/file/dirty จาก session; ถ้า dirty ให้ตั้ง `lastSavedContent` เป็นค่า sentinel เพื่อให้สถานะ dirty คงอยู่ถูกต้อง

### 1.3 `src/App.tsx` — แก้ 3 จุด

1. **กู้คืนเงียบๆ ตอนเปิด** (แทนบรรทัด 92-99 เดิม): ลบ `window.confirm` ออก → `loadSession()` แล้ว `hydrate` ทันที (ข้ามถ้าผู้ใช้พิมพ์ไปก่อนแล้ว) + ตั้ง ref `sessionReady` กัน race ที่ debounce save จะเขียนทับ session ก่อนกู้เสร็จ ถ้า session ชี้ไปที่โน้ตในกลุ่ม → เปิดโน้ตนั้นกลับมา
2. **บันทึกเสมอ** (แทนบรรทัด 101-106 เดิม): ตัดเงื่อนไข `dirty` ออก — save ทุกการเปลี่ยนแปลง (รวม path ไฟล์/โน้ตที่เปิด) debounce **800ms** เพื่อให้เปิดใหม่ได้สภาพเดิมเป๊ะแบบ Notepad
3. **Flush ตอนปิดหน้าต่าง** (effect ใหม่ — หัวใจของงานนี้): `getCurrentWindow().onCloseRequested(async (event) => { event.preventDefault(); → save+flush (Promise.race กับ timeout 3 วิ กันหน้าต่างปิดไม่ได้) → win.destroy() })` พร้อม flag `closing` กัน re-entry (ห้ามใช้ `win.close()` ใน handler เพราะจะวนลูป — `destroy()` ข้าม handler โดยธรรมชาติ)
4. ลบ `clearDraft()` ออกจาก `handleSave` และ `handleNew` — การ save-เสมอบันทึกสถานะใหม่แทนอยู่แล้ว (การ clear คือสาเหตุที่ save แล้วเปิดใหม่ได้หน้าว่าง)

### 1.4 `src-tauri/capabilities/default.json` — เพิ่ม permissions

```
core:window:allow-destroy            ← ไม่มีตัวนี้ destroy() fail = หน้าต่างปิดไม่ได้ (ต้องเทสต์!)
fs:allow-appdata-read-recursive      ← session.json
fs:allow-appdata-write-recursive
fs:allow-document-read-recursive     ← โน้ตใน Documents\PlainMark (ส่วนที่ 2)
fs:allow-document-write-recursive
fs:allow-mkdir, fs:allow-exists, fs:allow-rename, fs:allow-remove, fs:allow-read-dir
```

## ส่วนที่ 2 — แผงด้านขวา: จัดกลุ่ม/แบ่งกลุ่มโน้ต (ฟีเจอร์ใหม่)

**เป้าหมาย:** มีแท็บ/แผงด้านขวาไว้จัดกลุ่มโน้ต แยกเรื่องให้เปิดหาง่าย ค่าเริ่มต้นแยกเป็นรายวัน หรือสร้างกลุ่มตั้งชื่อเองก็ได้ และสร้างโน้ตภายใต้กลุ่มนั้นๆ ได้ — โน้ตทุกตัว auto-save เสมอ ไม่มีวันหาย

### 2.1 โครงสร้างที่เก็บ (ไฟล์จริง มองเห็นได้)

```
Documents\PlainMark\
  2026-07-02\            ← กลุ่มรายวัน (สร้างอัตโนมัติเมื่อมีโน้ตใหม่วันนั้น)
    บันทึกประชุม.md
    ไอเดีย.md
  งานบริษัท\              ← กลุ่มที่ผู้ใช้ตั้งชื่อเอง
    สเปกระบบ.md
```

- 1 กลุ่ม = 1 โฟลเดอร์, 1 โน้ต = 1 ไฟล์ `.md` — ไม่ต้องมี index กลาง (อ่านโครงสร้างจาก `readDir` ตรงๆ กันข้อมูล index กับไฟล์ไม่ตรงกัน)
- เปลี่ยนชื่อโน้ต/กลุ่ม = rename ไฟล์/โฟลเดอร์, ย้ายกลุ่ม = ย้ายไฟล์
- ชื่อไฟล์ sanitize อักขระต้องห้ามของ Windows (`\ / : * ? " < > |`), ชื่อซ้ำต่อท้าย `(2)`

### 2.2 สร้าง `src/lib/noteService.ts` (ใหม่)

ฟังก์ชัน fs ทั้งหมดของระบบโน้ต: `ensureNotesRoot()` (สร้าง `Documents\PlainMark` ถ้ายังไม่มี), `listGroups()` / `listNotes(group)` ผ่าน `readDir`, `createGroup(name)`, `createNote(group?, title?)` — ถ้าไม่ระบุกลุ่ม → กลุ่มชื่อวันนี้ (`YYYY-MM-DD`) สร้างให้อัตโนมัติ, `readNote(path)`, `writeNote(path, content)`, `renameNote/renameGroup`, `moveNote(path, targetGroup)`, `deleteNote/deleteGroup` (ลบต้อง confirm)

### 2.3 สร้าง `src/store/notesStore.ts` (ใหม่ — zustand)

state: `groups: { name, notes: { name, path, modifiedAt }[] }[]`, `activeNotePath`, `sidebarOpen`; actions ครอบ noteService + `refresh()` โหลดต้นไม้ใหม่จากดิสก์

### 2.4 สร้าง `src/components/NotesSidebar.tsx` (ใหม่) + CSS ใน `app.css`

- แผงด้านขวาของ workspace (ปิด/เปิดได้ด้วยปุ่มใน header, จำสถานะไว้ใน settings)
- รายการกลุ่มแบบพับ/กางได้ เรียงกลุ่มวันที่ล่าสุดขึ้นก่อน, โน้ตในกลุ่มเรียงตามแก้ไขล่าสุด
- ปุ่ม **+ โน้ตใหม่** (เข้ากลุ่มวันนี้อัตโนมัติ) และ **+ กลุ่มใหม่** (ตั้งชื่อเอง)
- คลิกโน้ต → เปิดใน editor, ไฮไลต์โน้ตที่เปิดอยู่
- เมนูต่อรายการ: เปลี่ยนชื่อ / ย้ายไปกลุ่ม… / ลบ (confirm ก่อน)

### 2.5 การทำงานร่วมกับ editor และ auto-save

- เปิดโน้ต → โหลดเข้า docStore พร้อม `notePath`; พิมพ์แล้ว **auto-save ลงไฟล์ .md ของโน้ตโดยตรง** (debounce 800ms + flush ตอนปิดหน้าต่าง ใช้กลไกเดียวกับส่วนที่ 1) — โน้ตไม่มีแนวคิด "ยังไม่บันทึก" เพราะบันทึกเสมอ status bar แสดง "บันทึกอัตโนมัติแล้ว"
- สลับโน้ต/สร้างโน้ตใหม่ → flush โน้ตเดิมก่อนสลับ (ไม่มีทางหาย)
- เมนู Open/Save/Export เดิมยังใช้ได้กับไฟล์ภายนอก (พฤติกรรม dirty + session draft เดิมคุ้มครอง) — Ctrl+S ตอนเปิดโน้ต = force flush ทันที
- session.json (ส่วนที่ 1) จำว่าเปิดโน้ตไหนค้างไว้ → เปิดแอปใหม่กลับมาที่โน้ตเดิม ตำแหน่งเดิม

## ส่วนที่ 3 — Persist settings

`src/store/settingsStore.ts`: ห่อด้วย zustand `persist` middleware (`create<SettingsState>()(persist(...))` แบบ curried), key `plainmark:settings`, partialize เฉพาะ layout/theme/showLineNumbers/recentFiles/sidebarOpen

## ส่วนที่ 4 — ไอคอน + build installer ได้จริง

1. สร้าง PNG 1024×1024 ด้วย PowerShell System.Drawing (พื้น slate-800, ตัว "P" สีฟ้า ตาม brand ใน App.tsx) เก็บที่ `assets/icon-source.png` (commit เข้า repo ด้วย)
2. `npx tauri icon assets/icon-source.png` → ได้ `src-tauri/icons/` ครบชุดรวม `icon.ico`
3. แก้ `src-tauri/tauri.conf.json`:
   - `bundle.icon` = รายการไอคอนมาตรฐาน, `bundle.targets` = `["nsis", "msi"]`
   - เพิ่ม metadata: publisher, shortDescription, longDescription, copyright
   - `windows.nsis.installMode: "currentUser"` (ติดตั้งไม่ต้องใช้สิทธิ์ admin)
   - เพิ่ม `"label": "main"` ให้ window (ให้ตรง capability ชัดเจน)
   - **แก้บั๊ก CSP**: `connect-src` เพิ่ม `ipc: http://ipc.localhost` (ไม่งั้นแอปที่ติดตั้งจริงเรียก dialog/fs/session ไม่ได้เลย — dev จะไม่เจอบั๊กนี้)

## ส่วนที่ 5 — เทสต์

- `src/lib/session.test.ts` (ใหม่): roundtrip โหมด browser, JSON พัง → null, migration จาก key เก่า; โหมด Tauri ด้วย `vi.mock('@tauri-apps/plugin-fs')` + mock `__TAURI_INTERNALS__` — ตรวจลำดับ tmp-write→rename และ latest-wins coalescing
- `src/lib/noteService.test.ts` (ใหม่): sanitize ชื่อไฟล์, ชื่อซ้ำ → `(2)`, ชื่อกลุ่มวันนี้ format `YYYY-MM-DD`, สร้างโน้ตโดยไม่ระบุกลุ่ม → ลงกลุ่มวันนี้ (mock fs)
- `src/store/docStore.test.ts` (ใหม่): hydrate dirty=true คง dirty, hydrate dirty=false ตั้ง lastSavedContent ถูก
- เทสต์เดิม (formatActions, markdownEngine) ต้องผ่านครบ

## ส่วนที่ 6 — Git + GitHub Actions + README

1. **Init repo** ด้วย git ฝังใน GitHub Desktop (`C:\Users\KeyPe\AppData\Local\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe`):
   - ลบโฟลเดอร์ `.git` เปล่าทิ้ง (ยืนยันแล้วว่า 0 ไฟล์) → `git init -b main` → config user → `git add -A` → commit แรก
   - เพิ่ม `.gitignore`: `Thumbs.db`, `desktop.ini`
2. **`.github/workflows/release.yml`**: trigger ที่ tag `v*`, `permissions: contents: write`, ใช้ `tauri-apps/tauri-action@v0` บน `windows-latest` (คอมเมนต์ matrix mac/linux ไว้เปิดทีหลัง), setup-node 20 + rust stable + rust-cache, สร้าง **draft release พร้อมไฟล์ installer ให้กดโหลดได้**
3. (แถม) workflow CI รัน `npm ci && npm test && npm run build` ตอน push/PR
4. **README.md**: หัวข้อ Download (ลิงก์ GitHub Releases, อธิบาย `-setup.exe` vs `.msi`), Build from source, Development, อธิบายระบบกลุ่มโน้ต + โฟลเดอร์ `Documents\PlainMark` และโน้ตว่างานทุกอย่างถูกบันทึกอัตโนมัติเสมอ
5. ผู้ใช้กด **Publish repository** ใน GitHub Desktop เอง แล้ว push tag `v0.1.0` เพื่อ trigger release build

## ไฟล์ที่แก้/สร้าง

| ไฟล์ | งาน |
|---|---|
| `src/lib/session.ts` | ใหม่ — แทน `src/lib/autosave.ts` (ลบทิ้ง) |
| `src/lib/noteService.ts` | ใหม่ — fs ของระบบกลุ่มโน้ต |
| `src/store/notesStore.ts` | ใหม่ — state ต้นไม้กลุ่ม/โน้ต |
| `src/components/NotesSidebar.tsx` | ใหม่ — แผงด้านขวา |
| `src/App.tsx` | กู้คืนเงียบ, save เสมอ 800ms, flush ตอนปิด, ผูก sidebar |
| `src/store/docStore.ts` | เพิ่ม `hydrate` + `notePath` |
| `src/store/settingsStore.ts` | zustand persist + sidebarOpen |
| `src/styles/app.css` | สไตล์ sidebar |
| `src-tauri/capabilities/default.json` | permissions ใหม่ (appdata + documents + window destroy) |
| `src-tauri/tauri.conf.json` | icon, targets, metadata, แก้ CSP |
| `assets/icon-source.png`, `src-tauri/icons/*` | ใหม่ |
| `src/lib/session.test.ts`, `src/lib/noteService.test.ts`, `src/store/docStore.test.ts` | ใหม่ |
| `.github/workflows/release.yml`, `README.md`, `.gitignore` | ใหม่/แก้ |

## การตรวจสอบ (Verification)

1. `npm test` ผ่านทั้งหมด → `npm run build` (tsc) ผ่าน
2. `npm run tauri:dev` เทสต์มือ — auto-save:
   - พิมพ์ → กด X **ทันที** (<800ms) → เปิดใหม่ → ตัวอักษรสุดท้ายยังอยู่ ไม่มี dialog ถาม ✅ (เคสที่โค้ดเดิมทำงานหาย)
   - หน้าต่างต้องปิดได้ภายใน ~1 วิ (ถ้าปิดไม่ได้ = ขาด `core:window:allow-destroy`)
   - เปิดไฟล์ → แก้ → ปิดไม่ save → เปิดใหม่ → ไฟล์เดิม+เนื้อหา+สถานะ dirty กลับมาครบ
   - save แล้วปิด → เปิดใหม่ → ไฟล์เดิมยังเปิดอยู่ ไม่ dirty (ไม่ใช่หน้าว่าง)
   - วางรูปใหญ่ → ปิด → เปิดใหม่ → รูปยังอยู่ / เปลี่ยนธีม → เปิดใหม่ → ธีมคงอยู่
   - **ปิดเน็ต (airplane mode) แล้วทำซ้ำทุกข้อ → ต้องทำงานเหมือนเดิมทุกอย่าง**
   - ตรวจ `%APPDATA%\com.plainmark.app\session.json` มีจริง ไม่มี `.tmp` ค้าง
3. เทสต์มือ — ระบบกลุ่มโน้ต:
   - กด + โน้ตใหม่ → เกิดกลุ่มวันนี้ (`2026-07-02`) + ไฟล์ใน `Documents\PlainMark\2026-07-02\` จริง
   - พิมพ์ในโน้ต → ไฟล์ .md อัปเดตเองภายใน ~1 วิ ไม่ต้องกด save
   - สร้างกลุ่มตั้งชื่อเอง, ย้ายโน้ตข้ามกลุ่ม, เปลี่ยนชื่อ, ลบ (มี confirm) → โฟลเดอร์/ไฟล์จริงเปลี่ยนตาม
   - เปิดโน้ตค้างไว้ → ปิดแอป → เปิดใหม่ → กลับมาที่โน้ตเดิม
4. `npm run tauri:build` → ได้ `src-tauri/target/release/bundle/nsis/PlainMark_0.1.0_x64-setup.exe` + `.msi` → **ติดตั้งจริงแล้วเทสต์ซ้ำข้อ 2-3 + Open/Save dialog ต้องทำงาน** (พิสูจน์ CSP fix — dev จับไม่ได้)
5. git status สะอาด, commit ครบ → ผู้ใช้ publish ผ่าน GitHub Desktop → push tag → Actions build สำเร็จ

## ความเสี่ยง

- **OneDrive**: repo อยู่ใน OneDrive — sync อาจ lock ไฟล์ตอน cargo build และเสี่ยง `.git` พัง แนะนำตั้ง "Always keep on this device" หรือย้าย `CARGO_TARGET_DIR` ออกนอก OneDrive (`Documents` ของผู้ใช้ก็อยู่ใน OneDrive — โน้ตจะถูก sync ด้วย ถือเป็นข้อดี ได้ backup ฟรี แต่ auto-save ไม่พึ่งเน็ตอยู่แล้วเพราะ OneDrive เขียนลงดิสก์ก่อนค่อย sync)
- Build NSIS ครั้งแรกต้องโหลดเครื่องมือจากเน็ต
- Path git ของ GitHub Desktop ผูกกับเวอร์ชัน (`app-3.6.1`) — ถ้าไม่เจอให้ค้นใหม่ด้วย `Get-ChildItem -Recurse -Filter git.exe`
- ชื่อโน้ต/กลุ่มภาษาไทยเป็นชื่อไฟล์/โฟลเดอร์ Windows ได้ปกติ (NTFS รองรับ Unicode) แต่ต้อง sanitize อักขระต้องห้ามเสมอ
