import { useState } from 'react';
import { X } from 'lucide-react';

export interface CloseReasonTarget {
  itemType: 'note' | 'scratch' | 'card';
  scope: string;
  title: string;
  idOrPath: string;
  snapshot: Record<string, unknown>;
}

interface CloseReasonModalProps {
  target: CloseReasonTarget | null;
  onCancel: () => void;
  onConfirm: (payload: {
    reason: string;
    assignee: string;
    note: string;
  }) => Promise<void>;
}

const REASONS = [
  'ทำเสร็จเรียบร้อยแล้ว',
  'ส่งต่อให้คนอื่น',
  'คนอื่นรับไปทำต่อเอง',
  'ยกเลิก',
  'อื่น ๆ'
];

export function CloseReasonModal({ target, onCancel, onConfirm }: CloseReasonModalProps) {
  const [reason, setReason] = useState(REASONS[0]);
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!target) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm({ reason, assignee: assignee.trim(), note: note.trim() });
      setAssignee('');
      setNote('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="v5-modal-backdrop" onMouseDown={onCancel}>
      <form
        className="v5-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <div className="settings-row">
          <h3>เหตุผลก่อนปิด / ลบ: {target.title}</h3>
          <button type="button" className="note-mini-icon-btn" onClick={onCancel} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        <div className="v5-field">
          <label htmlFor="close-reason-select">เหตุผล</label>
          <select
            id="close-reason-select"
            className="settings-select"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="v5-field">
          <label htmlFor="close-assignee-input">ผู้รับต่อ (ไม่บังคับ)</label>
          <input
            id="close-assignee-input"
            className="settings-input"
            placeholder="ชื่อหรืออีเมลผู้รับต่อ…"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          />
        </div>

        <div className="v5-field">
          <label htmlFor="close-note-input">หมายเหตุเพิ่มเติม</label>
          <textarea
            id="close-note-input"
            rows={2}
            placeholder="บันทึกสั้น ๆ เพื่อย้อนดูภายหลัง…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="v5-btn" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="submit" className="v5-btn danger" disabled={submitting}>
            {submitting ? 'กำลังบันทึก…' : 'บันทึกเหตุผลและปิด'}
          </button>
        </div>
      </form>
    </div>
  );
}
