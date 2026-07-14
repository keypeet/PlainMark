// helper จัดรูปแบบวันที่-เวลาแบบ string ล้วน — ใช้ร่วมกันระหว่างชื่อไฟล์ snapshot กับป้ายเวลาในแผงประวัติ

/** เติม 0 ข้างหน้าให้เป็น 2 หลัก (7 → "07") — ใช้ประกอบวันที่/เวลาให้อ่านง่าย */
export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
