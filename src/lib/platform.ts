// ศูนย์กลางเรื่องสภาพแวดล้อม Tauri — ทุกไฟล์เช็ค/โหลดโมดูล Tauri ผ่านที่นี่ที่เดียว
// โหลดแบบ dynamic import เพื่อให้โหมด browser (npm run dev) รันได้โดยไม่มี Tauri runtime

export const hasTauri = '__TAURI_INTERNALS__' in window;

export function tauriPath() {
  return import('@tauri-apps/api/path');
}

export function tauriFs() {
  return import('@tauri-apps/plugin-fs');
}

export function tauriDialog() {
  return import('@tauri-apps/plugin-dialog');
}

export function tauriWindow() {
  return import('@tauri-apps/api/window');
}

export function tauriWebview() {
  return import('@tauri-apps/api/webview');
}

export function tauriCore() {
  return import('@tauri-apps/api/core');
}
