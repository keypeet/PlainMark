import { BookMarked, BrainCircuit, Mic } from 'lucide-react';
import type { AppSection } from '../types';

interface ModulePlaceholderProps {
  section: Exclude<AppSection, 'notes'>;
  onBackToNotes: () => void;
}

const moduleCopy: Record<
  Exclude<AppSection, 'notes'>,
  { title: string; phase: string; desc: string; bullets: string[] }
> = {
  meetings: {
    title: 'Meeting Intelligence',
    phase: 'แผน 2 — พร้อมพัฒนาต่อ',
    desc: 'นำเข้าไฟล์ประชุม MP4 หรือไฟล์เสียง แยกคนพูด จับภาพหน้าจอช่วงสำคัญ กดประโยคไหนกระโดดไปฟังตรงนั้นทันที และสรุปด้วย CLI ในเครื่อง',
    bullets: [
      'ตรวจสอบ Phase 0 ผ่านแล้ว: OpenVINO 2026.4.1 เห็น CPU + Intel Arc 140V GPU + NPU ครบใต้ Smart App Control',
      'ASR: Whisper Large-v3 / Turbo ผ่าน OpenVINO (Arc 140V) + Diarization ผ่าน ONNX Runtime (ผ่าน SAC)',
      'อ่านสไลด์ด้วย LM Studio (typhoon-ocr-7b) และสรุปประชุมด้วย claude -p / codex / gemini'
    ]
  },
  knowledge: {
    title: 'Knowledge Hub',
    phase: 'แผน 3 — เตรียมพื้นที่ไว้แล้ว',
    desc: 'เก็บลิงก์ บทความ YouTube และเอกสาร PDF ที่สนใจ ให้ AI ในเครื่องสรุปรายชิ้นและสรุปรายวัน (Daily Digest) พร้อมบันทึกความสนใจตามช่วงเวลา',
    bullets: [
      'รับ URL / YouTube / PDF / ข้อความสั้น ๆ พร้อมโน้ตว่าทำไมถึงเซฟ',
      'สรุปรายชิ้นด้วย LM Studio (ฟรี) และทำ Daily Digest รายวันคู่กับ Self_development',
      'ค้นหาและเชื่อมกลับไปยังโน้ตโปรเจคใน PlainMark ได้ทันที'
    ]
  },
  insights: {
    title: 'Unified Personal AI Brain',
    phase: 'แผนพิเศษ — เชื่อมทุกโปรเจคเข้าด้วยกัน',
    desc: 'รวมข้อมูลจาก PlainMark Notes + Meetings + Knowledge เข้ากับ Self_development SQLite เพื่อสร้างโปรไฟล์ความสนใจและบริบทข้ามทุกโปรเจค',
    bullets: [
      'ต่อ adapter อ่านโน้ต ประชุม และความรู้เข้า Self_development แบบ read-only',
      'อัปเดตโปรไฟล์ interests-timeline.md และ active-projects-context.md อัตโนมัติ',
      'ส่งบริบทกลับให้ AI ทุกค่ายผ่าน personal-memory skill และปุ่มลัดใน TokenCheck (Typo)'
    ]
  }
};

export function ModulePlaceholder({ section, onBackToNotes }: ModulePlaceholderProps) {
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
        <ul className="module-list">
          {info.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button type="button" className="module-back-btn" onClick={onBackToNotes}>
          กลับไปหน้า Notes
        </button>
      </div>
    </section>
  );
}
