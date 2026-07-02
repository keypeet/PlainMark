# PlainMark v0.5 — Implementation Plan for AI Agent

**Objective:** Evolve the PlainMark MVP into a robust, user-friendly application by implementing a reliable auto-save system, a note management sidebar, and refining core usability features as requested.

**Guiding Principles:**
1.  **Never Lose Work:** All user input must be saved automatically and reliably.
2.  **Text is King:** The underlying data remains plain text (`.md`), ensuring portability.
3.  **Frictionless UX:** Features should be intuitive, reducing cognitive load (e.g., not having to remember Markdown syntax).


เป้าหมาย จากฉัน
"
เป็นการแก้เพิ่มเติมอีกนิด 
1. การใส่รูป รูปที่ใส่ ปกติฝั่งที่เขียน มันจะเสียงเป็น path ดังนั้น ถ้ามีการวางรูป ก็ควรที่จะมีการย่อ path ด้วยเพื่อไม่ให้ยาวเกินไป 
2. การใส่ลิงค์ของเว็บก็เช่นเกียวกัน จะต้อง มีการย่อ path ด้วยเพื่อไม่ให้ยาวเกินไป 
3. ในส่วนของการเพิ่มตาราง ตอนคลิกเพิ่มตาราง จะสามารถเลือกได้ว่าเอาแถวกี่แถว เอาช่องกี่ช่อง
4. Bullet List ควรจะสามารถเลือกได้ว่าเอาแบบไหน จุดวงกลม หรือตัวเลขหรืออื่นๆ
"


---

## Part 1: Implement Rock-Solid Auto-Save and Session Recovery

**Goal:** Ensure no work is ever lost, mimicking the behavior of modern applications like Notepad where content is automatically saved and restored across sessions.

**Tasks:**

1.  **Create `src/lib/session.ts`:**
    *   This module will manage the application's session state.
    *   Define a `SessionState` interface: `{ content: string, filePath: string | null, notePath: string | null, isDirty: boolean, lastModified: Date }`.
    *   Implement `saveSession(state: SessionState)`:
        *   Serializes the session state to JSON.
        *   Saves to a `session.json` file in the user's app data directory (use `@tauri-apps/plugin-fs`).
        *   **Crucially**, use a temp file and atomic rename (`.tmp` -> `.json`) to prevent corruption.
    *   Implement `loadSession(): Promise<SessionState | null>`:
        *   Reads and deserializes `session.json`.
        *   Handles file-not-found or parsing errors gracefully by returning `null`.
    *   Implement `clearSession()` for cleanup during testing or creating a new file.

2.  **Refactor `src/App.tsx` for Session Handling:**
    *   **On Startup:**
        *   Remove any existing confirmation dialogs for restoring drafts.
        *   Call `loadSession()`. If a session exists, silently load its content into the editor state (`docStore`). The user should see their last work immediately.
    *   **On Content Change:**
        *   Modify the existing `debounce` mechanism in the editor.
        *   On every keystroke (debounced to ~800ms), call `saveSession()` with the latest editor content, file path, and dirty status. The session file should be continuously updated.
    *   **On Window Close:**
        *   Implement a handler for the `onCloseRequested` event from Tauri's window object.
        *   In the handler:
            1.  `event.preventDefault()` to stop the window from closing immediately.
            2.  Call `saveSession()` one last time to ensure the very latest state is flushed to disk.
            3.  After the save promise resolves, call `window.destroy()` to close the application.
            4.  Include a `Promise.race` with a timeout (e.g., 2 seconds) to prevent a failed save from blocking the app from closing.

---

## Part 2: Implement Note Organization Sidebar

**Goal:** Allow users to organize notes into groups, making the app a true note-taking solution rather than a single-file editor. Notes will be stored as `.md` files in the user's `Documents/PlainMark` directory.

**Tasks:**

1.  **Create `src/lib/noteService.ts`:**
    *   This module handles all file system operations related to notes.
    *   Use `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-path` for all operations.
    *   `listNotesAndGroups()`: Reads the `Documents/PlainMark` directory structure. Each sub-directory is a "group", and each `.md` file within is a "note". Returns a tree structure.
    *   `createNote(group: string, title: string, content: string)`: Creates a new `.md` file. Handles sanitizing filenames and ensuring unique names (e.g., appending ` (2)` if the name exists).
    *   `createGroup(name: string)`: Creates a new sub-directory.
    *   `readNote(path: string)`: Reads note content.
    *   `writeNote(path: string, content: string)`: Writes content to a note. This will be the target for the auto-save mechanism when a note is active.
    *   `renameNote()`, `renameGroup()`, `deleteNote()`, `deleteGroup()`: Implement the corresponding file/directory operations.

2.  **Create `src/store/notesStore.ts` (Zustand):**
    *   This store will hold the state of the note hierarchy.
    *   State: `{ groups: Group[], activeNotePath: string | null }`.
    *   Actions: `refreshNotes()`, `setActiveNote(path)`, etc., which will call the `noteService`.

3.  **Create `src/components/NotesSidebar.tsx`:**
    *   A new component that displays the groups and notes from `notesStore`.
    *   Render groups as collapsible sections.
    *   Render notes within each group, sorted by modification date (newest first).
    *   On note click: call the action to set the active note, load its content into `docStore`.
    *   Provide context menus (right-click) on notes and groups for "Rename", "Delete", etc.
    *   Include a "**+ New Note**" button. When clicked, it should create a new note under a default group (e.g., a group named with today's date `YYYY-MM-DD`, which is created if it doesn't exist).

---

## Part 3: Refine Toolbar and Formatting Actions

**Goal:** Enhance the core formatting tools based on user feedback to make them more powerful and intuitive.

**Tasks:**

1.  **Update Table Creation (`FR-15`):**
    *   When the "Table" button in the `Toolbar` is clicked, do not insert a fixed template.
    *   Instead, show a small pop-over or dialog near the button.
    *   This dialog will contain input fields for "**Rows**" and "**Columns**".
    *   On confirmation, generate a Markdown table of the specified dimensions and insert it into the editor.

2.  **Update List Creation (`FR-20`):**
    *   When the "List" button is clicked, present a choice to the user.
    *   This can be a dropdown or a small set of sub-buttons that appear on hover/click.
    *   The choices should be:
        *   **Bulleted List** (using `- `)
        *   **Numbered List** (using `1. `)
        *   **Task List** (using `- [ ] `)
    *   The selected list format will then be applied.

    *   When the "Image" button is used, or an image is pasted/dropped:
    *   For **pasted/dropped images**, they will be converted to base64 data URLs. These will be automatically converted to **reference-style images** in the editor.
    *   For **image links (URLs)**, if the URL is longer than a certain threshold (e.g., 50 characters), it should also be converted to a **reference-style image**.
    *   This ensures the main body of the text remains clean and readable, without long base64 strings or URLs cluttering the editor.

4.  **Implement Smart Link Handling (`FR-19`):**
    *   When the "Link" button is used or a URL is pasted:
    *   **Check the URL length.** If a pasted URL is longer than a certain threshold (e.g., 50 characters), automatically convert it to a **reference-style link**.
    *   Example for both images and links:
        1.  User pastes: `https://very.long.and.complex/url/with/many/parts/and/query/params?id=123`
        2.  The editor inserts: `[Pasted Link][ref1]` (for a link) or `![Pasted Image][img1]` (for an image) at the cursor.
        3.  The reference definition is added to the bottom of the document: `[ref1]: https://very.long.and.complex/url/with/many/parts/and/query/params?id=123` or `[img1]: https://very.long.and.complex/url/with/many/parts/and/query/params?id=123`
    *   This keeps the main body of the text clean and readable.

---

## Part 4: Finalize Build and Configuration

**Goal:** Prepare the application for distribution with proper icons, metadata, and security settings.

**Tasks:**

1.  **Generate Application Icons:**
    *   Create a source icon file `assets/icon-source.png` (e.g., 1024x1024).
    *   Use the `npx tauri icon` command to generate the complete icon set for all platforms.

2.  **Configure `src-tauri/tauri.conf.json`:**
    *   Fill in the `bundle.icon` array with the paths to the generated icons.
    *   Update `bundle.identifier`, `package.productName`, and other metadata.
    *   **Crucially, update the Content Security Policy (CSP):** Add `ipc: http://ipc.localhost` to `connect-src` to ensure the frontend can communicate with the Rust backend in the final bundled application.

3.  **Update Tauri Capabilities (`src-tauri/capabilities/default.json`):**
    *   Ensure all necessary file system permissions are granted for the app data directory and the `Documents/PlainMark` directory.
    *   Add `core:window:allow-destroy` to allow the close handler to function correctly.
    *   Scope permissions as tightly as possible for security.

4.  **Test the Build:**
    *   Run `npm run tauri build`.
    *   Install the generated application (`.msi` or `.exe` on Windows).
    *   Perform end-to-end testing on the installed application to confirm all features, especially file system access and session handling, work as expected outside of the dev environment.
