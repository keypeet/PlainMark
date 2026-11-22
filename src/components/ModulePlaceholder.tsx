import { useEffect, useState } from 'react';
import { BookMarked, BrainCircuit, Mic } from 'lucide-react';
import { apiListKnowledge, apiListMeetings, apiListNotes } from '../lib/api';
import { useNotesStore } from '../store/notesStore';
import type { AppSection } from '../types';

interface ModulePlaceholderProps {
  section: Exclude<AppSection, 'notes' | 'settings'>;
  onBackToNotes: () => void;
}

const moduleCopy: Record<
  Exclude<AppSection, 'notes' | 'settings'>,
  { title: string; phase: string; desc: string; bullets: string[] }
> = {
  insights: {
    title: 'Insights',
    phase: 'Phase 1.5c — พร้อมเชื่อมข้อมูลจริง',
    desc: 'สรุปล่าสุดถึงไหน, รายการทำต่อ, กระดานแผ่นแปะโน้ต, งานค้าง และผู้ช่วย AI แยกบริบทตามขอบเขต',
    bullets: [
      'Change-Only Smart Sync: ตรวจ source_hash ก่อนสรุป (ไม่เปลี่ยน = 0 tokens)',
      'Sticky Board: แปะโน้ตสั้น, ลากย้าย, เชื่อมลิงก์ภายในและภายนอก',
      'รองรับทั้งภาพรวม (ทุกโปรเจค/ทั่วไป) และรายโปรเจค'
    ]
  },
  meetings: {
    title: 'Meetings',
    phase: 'Phase 1.5d & 2 — โครง Metadata พร้อมใช้',
    desc: 'หน้ารวมโฟลเดอร์ประชุม, หน้าละเอียดพร้อม Transcript/Slides/Action Items, คลังเสียง และ Privacy Gate (local_only)',
    bullets: [
      'ตั้งค่าเริ่มต้น local_only และเก็บเฉพาะ embedding ใน shared/voiceprints/',
      'แก้ Transcript หรือเปลี่ยนชื่อผู้พูด สร้าง snapshot ใน .history/ อัตโนมัติ',
      'สแตกออฟไลน์: OpenVINO Whisper + OpenThai 2.0 ASR ONNX FP32 + OpenThai 2.1 OCR-Text'
    ]
  },
  knowledge: {
    title: 'Knowledge',
    phase: 'Phase 1.5d & 3 — โครง Metadata พร้อมใช้',
    desc: 'เก็บลิงก์เว็บ, YouTube, PDF และเหตุผลที่เซฟ แยกตามวัน พร้อมสถานะอ่านแล้ว/ยังไม่ได้อ่าน',
    bullets: [
      'สรุปสำหรับผู้เริ่มต้น: คืออะไร / ประเด็นสำคัญ / เอาไปใช้กับงานเราได้ยังไง',
      'เชื่อมเข้า Insights เพื่อให้รู้เรื่องควรรู้ที่ยังไม่ได้เปิดอ่าน',
      'รองรับย้ายรายการ General ↔ Project ตลอดเวลา'
    ]
  }
};

export function ModulePlaceholder({ section, onBackToNotes }: ModulePlaceholderProps) {
  const activeScope = useNotesStore((state) => state.activeScope);
  const [counts, setCounts] = useState<{ notes: number; meetings: number; knowledge: number }>({
    notes: 0,
    meetings: 0,
    knowledge: 0
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiListNotes(activeScope).catch(() => ({ notes: [] })),
      apiListMeetings(activeScope, 1).catch(() => ({ items: [], total: 0 })),
      apiListKnowledge(activeScope).catch(() => ({ items: [] }))
    ]).then(([n, m, k]) => {
      if (cancelled) return;
      setCounts({
        notes: n.notes.length,
        meetings: m.total,
        knowledge: k.items.length
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activeScope, section]);

  const info = moduleCopy[section];
  const Icon = section === 'meetings' ? Mic : section === 'knowledge' ? BookMarked : BrainCircuit;

  return (
    <section className="module-placeholder">
      <div className="module-card">
        <div className="module-badge">{info.phase}</div>
        <div className="module-head">
          <Icon size={24} />
          <h1>{info.title}</h1>
        </div>
        <p className="module-desc">{info.desc}</p>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          ขอบเขต <code>{activeScope}</code>: โน้ต {counts.notes} · ประชุม {counts.meetings} · ความรู้ {counts.knowledge}
        </p>
        <ul className="module-list">
          {info.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button type="button" className="module-back-btn" onClick={onBackToNotes}>
          ไปหน้า Notes
        </button>
      </div>
    </section>
  );
}
