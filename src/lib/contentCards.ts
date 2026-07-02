// Auto Detect Content — ทำให้ preview ฉลาดขึ้นโดย "ไม่แก้ Markdown ต้นฉบับ" (advanced_features.md ข้อ 2)
//
// หลักการ: ย่อหน้าที่มีแค่ลิงก์เดียว → แปลงเป็น card ตอน render
//   YouTube URL → Video Card | GitHub repo → Repository Card | ลิงก์ .pdf → File Card | Email → Mail Card
// รองรับทั้ง URL เปล่า (linkify), ลิงก์มีชื่อ [ชื่อ](url) และ reference-style ที่แอปย่อให้ตอน paste
import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export type CardType = 'youtube' | 'github' | 'pdf' | 'email';

export interface CardInfo {
  type: CardType;
  /** ชื่อที่โชว์บน card เมื่อลิงก์ไม่มี label เอง */
  title: string;
  /** เฉพาะ youtube: id ของวิดีโอ (ใช้ประกอบ thumbnail) */
  videoId?: string;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** ดึง video id จาก YouTube URL รูปแบบ watch / youtu.be / shorts / embed */
export function youtubeVideoId(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, '');
  const idPattern = /^[\w-]{6,20}$/;

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    return idPattern.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v') ?? '';
      return idPattern.test(id) ? id : null;
    }
    const path = parsed.pathname.match(/^\/(?:shorts|embed)\/([\w-]{6,20})$/);
    if (path) return path[1];
  }
  return null;
}

/** จับ URL หน้า repo ของ GitHub (github.com/owner/repo เท่านั้น — ลึกกว่านั้นไม่ใช่หน้า repo) */
export function githubRepo(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname.replace(/^www\./, '') !== 'github.com') return null;
  const match = parsed.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  // หน้า owner-level ที่ไม่ใช่ repo เช่น /settings, /orgs
  if (['settings', 'orgs', 'topics', 'collections', 'sponsors', 'marketplace'].includes(owner)) return null;
  return `${owner}/${repo}`;
}

export function isPdfUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed ? /\.pdf$/i.test(parsed.pathname) : false;
}

/** จำแนกชนิด card จาก href — คืน null ถ้าเป็นลิงก์ธรรมดา */
export function classifyUrl(href: string): CardInfo | null {
  if (href.startsWith('mailto:')) {
    return { type: 'email', title: href.slice('mailto:'.length) };
  }
  const videoId = youtubeVideoId(href);
  if (videoId) return { type: 'youtube', title: 'วิดีโอ YouTube', videoId };
  const repo = githubRepo(href);
  if (repo) return { type: 'github', title: repo };
  if (isPdfUrl(href)) {
    const fileName = decodeURIComponent(href.split('/').pop() ?? '') || 'เอกสาร PDF';
    return { type: 'pdf', title: fileName };
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const cardTypeLabel: Record<CardType, string> = {
  youtube: 'YouTube',
  github: 'GitHub Repository',
  pdf: 'PDF',
  email: 'Email'
};

const cardIcon: Record<CardType, string> = {
  youtube: '▶',
  github: '⌂',
  pdf: '⎙',
  email: '✉'
};

/** สร้าง HTML ของ card (ผ่าน DOMPurify ทีหลังใน renderMarkdown เสมอ) */
export function renderCard(href: string, label: string, info: CardInfo): string {
  // label ที่เป็นตัว URL เอง = ลิงก์เปล่า → ใช้ชื่อจาก classifier แทน
  const title = label && label !== href ? label : info.title;
  const safeHref = escapeHtml(href);
  const safeTitle = escapeHtml(title);
  const shownUrl = escapeHtml(href.replace(/^(https?:\/\/|mailto:)/, ''));

  const thumb =
    info.type === 'youtube' && info.videoId
      ? `<span class="card-thumb"><img src="https://img.youtube.com/vi/${escapeHtml(info.videoId)}/hqdefault.jpg" alt=""><span class="card-play">▶</span></span>`
      : `<span class="card-icon card-icon-${info.type}">${cardIcon[info.type]}</span>`;

  return (
    `<a class="content-card card-${info.type}" href="${safeHref}" target="_blank" rel="noopener noreferrer">` +
    thumb +
    `<span class="card-body">` +
    `<span class="card-type">${cardTypeLabel[info.type]}</span>` +
    `<span class="card-title">${safeTitle}</span>` +
    `<span class="card-url">${shownUrl}</span>` +
    `</span></a>`
  );
}

/** เช็คว่า inline token เป็น "ลิงก์เดียวทั้งย่อหน้า" → คืน href + label */
function soleLink(inline: Token): { href: string; label: string } | null {
  const children = inline.children ?? [];
  const meaningful = children.filter((token) => !(token.type === 'text' && !token.content.trim()));
  if (meaningful.length < 2 || meaningful.length > 3) return null;
  const [open, ...rest] = meaningful;
  const close = meaningful[meaningful.length - 1];
  if (open.type !== 'link_open' || close.type !== 'link_close') return null;
  const middle = rest.slice(0, -1);
  if (middle.length === 1 && middle[0].type !== 'text') return null;

  const href = open.attrGet('href') ?? '';
  const label = middle.length === 1 ? middle[0].content : '';
  return href ? { href, label } : null;
}

/** markdown-it plugin: แทนที่ย่อหน้าลิงก์เดี่ยวด้วย content card */
export function contentCardsPlugin(md: MarkdownIt): void {
  md.core.ruler.push('content_cards', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i + 2 < tokens.length; i += 1) {
      if (tokens[i].type !== 'paragraph_open' || tokens[i + 1].type !== 'inline' || tokens[i + 2].type !== 'paragraph_close') {
        continue;
      }
      const link = soleLink(tokens[i + 1]);
      if (!link) continue;
      const info = classifyUrl(link.href);
      if (!info) continue;

      const card = new state.Token('html_block', '', 0);
      card.content = renderCard(link.href, link.label, info);
      card.block = true;
      tokens.splice(i, 3, card);
    }
  });
}
