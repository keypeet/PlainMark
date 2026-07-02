// helper จัดการ path แบบ string ล้วน — รองรับทั้ง \ (Windows) และ / ใช้ร่วมกันทุกไฟล์
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

export function baseName(path: string): string {
  return pathSegments(path).pop() ?? '';
}
