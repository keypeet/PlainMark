# Advanced Features --- PlainMark

## Purpose

เอกสารนี้อธิบายฟีเจอร์ที่ช่วยให้ PlainMark เป็น "Notepad สำหรับ Markdown"
ที่ใช้งานง่ายที่สุด

------------------------------------------------------------------------

# 1. Slash Command (/)

## Goal

เพิ่มองค์ประกอบโดยไม่ต้องใช้เมาส์

รองรับ Heading, Table, Quote, Image, Code, Todo, Link และค้นหาแบบ fuzzy

------------------------------------------------------------------------

# 2. Auto Detect Content

## Goal

Preview ฉลาดขึ้นโดยไม่แก้ Markdown

  Input         Preview
  ------------- -----------------
  YouTube URL   Video Card
  GitHub URL    Repository Card
  PDF           File Card
  Email         Mail Card

Markdown ต้นฉบับต้องไม่ถูกแก้

------------------------------------------------------------------------

# 3. Paste Anything

## Goal

Paste จากทุกแหล่งแล้วแปลงเป็น Markdown

-   Microsoft Word
-   Excel → Markdown Table
-   HTML → Markdown
-   Rich Text
-   Screenshot → Base64 Image
-   URL

------------------------------------------------------------------------

# 4. Floating Toolbar

แสดง Toolbar ลอยเมื่อเลือกข้อความ

-   Bold
-   Italic
-   Link
-   Code
-   Heading

------------------------------------------------------------------------

# 5. Hover Preview

Hover Markdown แล้ว Preview เฉพาะจุด

รองรับ Image, Table, Link, Code และ Quote

------------------------------------------------------------------------

# 6. Smart Auto-format

ช่วยเติม Markdown อัตโนมัติ

-   Ordered List
-   Bullet List
-   Checklist
-   Quote
-   Heading
-   Horizontal Rule
-   Link Detection

------------------------------------------------------------------------

# Development Priority

  Feature               Priority
  --------------------- ----------
  Smart Auto-format     MVP
  Paste Anything        MVP+
  Slash Command         MVP+
  Floating Toolbar      Post-MVP
  Hover Preview         Post-MVP
  Auto Detect Content   Post-MVP

------------------------------------------------------------------------

# Product Vision

PlainMark ไม่ควรแข่งขันว่าเป็น Markdown Editor ที่มีฟีเจอร์มากที่สุด

แต่ควรเป็น

> **Markdown Editor ที่ใช้ง่ายที่สุดสำหรับคนทั่วไป**

หลักการออกแบบ

1.  ผู้ใช้ไม่ต้องจำ Markdown
2.  ทุกฟีเจอร์ช่วยลดการคิด
3.  เริ่มต้นง่ายเหมือน Notepad
4.  ไฟล์ยังคงเป็น Markdown มาตรฐาน
