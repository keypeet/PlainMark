import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Loader2 } from 'lucide-react';
import { apiGetMeetingAsr, apiStartMeetingAsr, type MeetingAsr } from '../lib/api';

interface MeetingTranscribeControlProps {
  meetingId: string;
  hasVideo: boolean;
  hasTranscript: boolean;
  /** Called once a run finishes with new text, so the page can reload the transcript. */
  onTranscribed: () => void;
  onNotice: (msg: string) => void;
}

const POLL_MS = 3000;

export function MeetingTranscribeControl({
  meetingId,
  hasVideo,
  hasTranscript,
  onTranscribed,
  onNotice
}: MeetingTranscribeControlProps) {
  const [state, setState] = useState<MeetingAsr | null>(null);
  const [busy, setBusy] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      setState(await apiGetMeetingAsr(meetingId));
    } catch {
      setState({ status: 'failed', error: 'โหลดสถานะถอดเสียงไม่สำเร็จ' });
    }
  }, [meetingId]);

  useEffect(() => {
    wasRunning.current = false;
    void load();
  }, [load]);

  useEffect(() => {
    if (state?.status === 'running') {
      wasRunning.current = true;
      const timer = window.setTimeout(() => void load(), POLL_MS);
      return () => window.clearTimeout(timer);
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      if (state?.status === 'done') onTranscribed();
      else if (state?.error) onNotice(`ถอดเสียงไม่สำเร็จ: ${state.error}`);
    }
  }, [state, load, onTranscribed, onNotice]);

  const start = async () => {
    if (hasTranscript && !window.confirm('ถอดเสียงใหม่จะแทนข้อความเดิม (เก็บของเดิมไว้ในประวัติแก้ไข) ทำต่อไหม?')) {
      return;
    }
    setBusy(true);
    try {
      setState(await apiStartMeetingAsr(meetingId));
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'เริ่มถอดเสียงไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (!hasVideo) return null;

  if (state?.status === 'running') {
    const total = state.pieces || 0;
    const pct = total ? Math.round(((state.piecesDone || 0) / total) * 100) : 0;
    return (
      <span className="asr-status muted" role="status">
        <Loader2 size={13} className="spin-icon" />
        {total ? `กำลังถอดเสียง ${pct}%` : 'กำลังเตรียมเสียง…'}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="v5-btn"
      disabled={busy || !state}
      onClick={() => void start()}
      title="ถอดเสียงจากวิดีโอที่ลิงก์ไว้ ทำงานในเครื่องทั้งหมด"
    >
      <AudioLines size={13} /> {hasTranscript ? 'ถอดใหม่' : 'ถอดเสียง'}
    </button>
  );
}
