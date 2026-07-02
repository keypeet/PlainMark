// ปิด console window บน Windows ใน release build — ไม่งั้นเปิดแอปแล้วมีหน้าต่างดำติดมาด้วย
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    plainmark_lib::run()
}
