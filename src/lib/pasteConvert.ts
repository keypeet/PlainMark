// Paste Anything — แปลง HTML จาก clipboard (Word / Excel / เว็บ / Rich Text) เป็น Markdown
// ตาม advanced_features.md ข้อ 3 (ส่วนรูปภาพ → base64 และ URL → reference link อยู่ใน imagePaste/formatActions)
import TurndownService from 'turndown';
// @ts-expect-error — turndown-plugin-gfm ไม่มี type definitions
import { gfm } from 'turndown-plugin-gfm';

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: 'atx', // # Heading แบบเดียวกับที่ toolbar ใช้
    codeBlockStyle: 'fenced', // ``` แบบเดียวกับ createCodeBlock
    bulletListMarker: '-',
    emDelimiter: '*'
  });
  turndown.use(gfm); // ตาราง (Excel/Word) + strikethrough + task list

  // ค่าเริ่มต้นของ turndown คือ "-   item" (เว้น 3 ช่อง) — ปรับเป็น "- item" ให้ตรงสไตล์เดียวกับ toolbar/slash command
  turndown.addRule('plainListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n  ');
      const parent = node.parentNode as HTMLElement | null;
      let prefix = `${options.bulletListMarker} `;
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1);
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start + index}. `;
      }
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
    }
  });
  return turndown;
}

// แท็กที่บอกว่า HTML มี "โครงสร้าง" คุ้มค่าที่จะแปลงเป็น Markdown
const structuralTags =
  /<(h[1-6]|table|ul|ol|li|blockquote|pre|code|a |a>|img|strong|b>|em|i>|del|hr)[\s>/]?/i;

/**
 * ตัดสินว่า HTML จาก clipboard ควรแปลงเป็น Markdown หรือไม่
 * ถ้าเป็นแค่ span/div ห่อข้อความล้วน (เช่น copy จาก editor ธรรมดา) ให้ใช้ plain text ตามเดิมดีกว่า
 */
export function shouldConvertHtml(html: string): boolean {
  return structuralTags.test(html);
}

/** แปลง HTML → Markdown (คืน '' ถ้าแปลงแล้วว่างเปล่า) */
export function htmlToMarkdown(html: string): string {
  try {
    return getTurndown().turndown(html).trim();
  } catch (error) {
    console.error('PlainMark: html to markdown failed', error);
    return '';
  }
}

/**
 * ทางเข้าหลักจาก paste handler: มี HTML ที่มีโครงสร้าง → คืน Markdown, ไม่ใช่ → คืน null
 * (null = ให้ paste ทำงานแบบข้อความธรรมดาตามเดิม)
 */
export function convertClipboardHtml(html: string | undefined): string | null {
  if (!html || !shouldConvertHtml(html)) return null;
  const markdown = htmlToMarkdown(html);
  return markdown || null;
}
