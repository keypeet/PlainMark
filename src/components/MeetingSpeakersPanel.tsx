import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Loader2, Mic, Play, RefreshCw, Users } from 'lucide-react';
import {
  apiDeleteVoiceprint,
  apiGetMeetingDiarization,
  apiNameMeetingSpeaker,
  apiStartMeetingDiarization,
  type DiarizationTurn,
  type DiarizedSpeaker,
  type MeetingDiarization,
  type VoiceprintItem
} from '../lib/api';
import { formatMediaTime } from './MeetingCapturePanel';

interface MeetingSpeakersPanelProps {
  meetingId: string;
  videoRef: RefObject<HTMLVideoElement>;
  voiceprints: VoiceprintItem[];
  onVoiceprintsChange: () => void;
  /** Speakers were found again or renamed, so transcript labels changed. */
  onSpeakersChange?: () => void;
  onNotice: (msg: string) => void;
}

const POLL_MS = 3000;
// theme tokens, so speaker colours follow light and dark mode
const SPEAKER_COLORS = [
  'var(--accent)',
  'var(--ok-dot)',
  'var(--warn-dot)',
  'var(--attn-dot)',
  'var(--info-dot)',
  'var(--ink-3)'
];

export function speakerLabel(speaker: DiarizedSpeaker, index: number): string {
  return speaker.name || `ผู้พูด ${index + 1}`;
}

/** Start of this speaker's next turn after `now`, wrapping to their first turn. */
export function nextTurnStart(
  turns: DiarizationTurn[],
  speakerId: string,
  now: number
): number | null {
  const own = turns.filter((t) => t.speakerId === speakerId).sort((a, b) => a.start - b.start);
  if (own.length === 0) return null;
  const next = own.find((t) => t.start > now + 0.5);
  return (next ?? own[0]).start;
}

export function MeetingSpeakersPanel({
  meetingId,
  videoRef,
  voiceprints,
  onVoiceprintsChange,
  onSpeakersChange,
  onNotice
}: MeetingSpeakersPanelProps) {
  const [state, setState] = useState<MeetingDiarization | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [remember, setRemember] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      setState(await apiGetMeetingDiarization(meetingId));
    } catch {
      setState({ status: 'failed', error: 'โหลดข้อมูลผู้พูดไม่สำเร็จ' });
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state?.status !== 'running') {
      if (wasRunning.current && state?.status === 'done') onSpeakersChange?.();
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const timer = window.setTimeout(() => void load(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [state, load, onSpeakersChange]);

  const start = async () => {
    const named = (state?.speakers || []).some((s) => s.name && !s.voiceprintId);
    if (named && !window.confirm('แยกใหม่จะล้างชื่อที่ไม่ได้จำเสียงไว้ ทำต่อไหม?')) return;
    setBusy(true);
    try {
      setState(await apiStartMeetingDiarization(meetingId));
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'เริ่มแยกผู้พูดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const saveName = async (
    speakerId: string,
    payload: { name: string; remember?: boolean; voiceprintId?: string }
  ) => {
    setBusy(true);
    try {
      setState(await apiNameMeetingSpeaker(meetingId, speakerId, payload));
      setEditingId(null);
      if (payload.remember) onVoiceprintsChange();
      onSpeakersChange?.();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'บันทึกชื่อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const forget = async (vp: VoiceprintItem) => {
    if (!window.confirm(`ลบลายเสียงของ ${vp.name}? ประชุมต่อไปจะจำเสียงนี้ไม่ได้อีก`)) return;
    try {
      await apiDeleteVoiceprint(vp.id);
      onVoiceprintsChange();
      onNotice(`ลบลายเสียงของ ${vp.name} แล้ว`);
    } catch {
      onNotice('ลบลายเสียงไม่สำเร็จ');
    }
  };

  const playFrom = (sec: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = sec;
    void video.play().catch(() => undefined);
  };

  if (!state) {
    return <p className="muted speakers-note">กำลังโหลด…</p>;
  }
  if (state.status === 'running') {
    return (
      <div className="speakers-status" role="status">
        <Loader2 size={16} className="spin-icon" />
        <span>กำลังแยกผู้พูด… คลิป 1 ชั่วโมงใช้ราว 2 นาที</span>
      </div>
    );
  }
  if (state.status !== 'done') {
    return (
      <div className="speakers-start">
        <p className="muted speakers-note">
          {state.status === 'none'
            ? 'หาว่าใครพูดช่วงไหนจากเสียงในวิดีโอ ทำงานในเครื่องทั้งหมด'
            : state.error || 'แยกผู้พูดไม่สำเร็จ'}
        </p>
        <button type="button" className="v5-btn primary" disabled={busy} onClick={() => void start()}>
          <Users size={14} /> {state.status === 'none' ? 'แยกผู้พูด' : 'ลองอีกครั้ง'}
        </button>
      </div>
    );
  }

  const speakers = state.speakers || [];
  const turns = state.turns || [];
  const duration = state.durationSec || Math.max(1, ...turns.map((t) => t.end));
  const savedById = new Map(voiceprints.map((vp) => [vp.id, vp]));

  return (
    <div className="speakers-panel">
      <div className="speakers-summary">
        <span className="muted">
          {speakers.length} คน · ยาว {formatMediaTime(duration)}
        </span>
        <button
          type="button"
          className="v5-btn"
          disabled={busy}
          onClick={() => void start()}
          title="แยกผู้พูดใหม่ทั้งคลิป"
        >
          <RefreshCw size={13} /> แยกใหม่
        </button>
      </div>
      {state.voiceprints === 'unavailable' && (
        <p className="muted speakers-note">
          ยังไม่ได้ติดตั้งโมเดลลายเสียง ตั้งชื่อได้ แต่ยังจำเสียงข้ามประชุมไม่ได้
        </p>
      )}

      <ul className="speakers-list">
        {speakers.map((sp, i) => {
          const color = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
          const label = speakerLabel(sp, i);
          const saved = sp.voiceprintId ? savedById.get(sp.voiceprintId) : undefined;
          const own = turns.filter((t) => t.speakerId === sp.id);
          return (
            <li key={sp.id} className="speaker-row" data-testid={`speaker-${sp.id}`}>
              <div className="speaker-row-head">
                <span className="speaker-dot" style={{ background: color }} />
                <strong className="speaker-name">{label}</strong>
                {sp.isMe && (
                  <span className="meeting-badge local" title="พูดตรงกับเสียงจากไมค์ของคุณ">
                    <Mic size={11} /> ฉัน
                  </span>
                )}
                {saved && <span className="meeting-badge shareable">จำเสียงแล้ว</span>}
                <span className="speaker-share muted">
                  {Math.round(sp.share * 100)}% · {formatMediaTime(sp.talkSec)}
                </span>
                <button
                  type="button"
                  className="note-mini-icon-btn"
                  aria-label={`เล่นช่วงถัดไปของ ${label}`}
                  title="เล่นช่วงถัดไปที่คนนี้พูด"
                  onClick={() => {
                    const at = nextTurnStart(turns, sp.id, videoRef.current?.currentTime ?? 0);
                    if (at !== null) playFrom(at);
                  }}
                >
                  <Play size={15} />
                </button>
              </div>

              <div
                className="speaker-timeline"
                title="คลิกเพื่อไปยังจุดนั้นในวิดีโอ"
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  playFrom(((e.clientX - box.left) / box.width) * duration);
                }}
              >
                {own.map((t, k) => (
                  <span
                    key={k}
                    style={{
                      left: `${(t.start / duration) * 100}%`,
                      width: `${Math.max(((t.end - t.start) / duration) * 100, 0.2)}%`,
                      background: color
                    }}
                  />
                ))}
              </div>

              {sp.suggestedVoiceprintId && sp.suggestedName && editingId !== sp.id && (
                <div className="speaker-suggest">
                  <span>เสียงคล้าย {sp.suggestedName} ใช่ไหม?</span>
                  <button
                    type="button"
                    className="v5-btn"
                    disabled={busy}
                    onClick={() =>
                      void saveName(sp.id, {
                        name: sp.suggestedName || '',
                        remember: !!sp.canRemember,
                        voiceprintId: sp.suggestedVoiceprintId
                      })
                    }
                  >
                    ใช่
                  </button>
                </div>
              )}

              {editingId === sp.id ? (
                <form
                  className="speaker-name-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!nameValue.trim()) return;
                    void saveName(sp.id, {
                      name: nameValue.trim(),
                      remember: remember && !!sp.canRemember,
                      voiceprintId: sp.voiceprintId
                    });
                  }}
                >
                  <input
                    className="settings-input"
                    aria-label="ชื่อผู้พูด"
                    value={nameValue}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => setNameValue(e.target.value)}
                  />
                  <label className={`speaker-remember${sp.canRemember ? '' : ' muted'}`}>
                    <input
                      type="checkbox"
                      checked={remember && !!sp.canRemember}
                      disabled={!sp.canRemember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    จำเสียงไว้ใช้ประชุมต่อไป
                  </label>
                  <div className="speaker-actions">
                    <button
                      type="submit"
                      className="v5-btn primary"
                      disabled={busy || !nameValue.trim()}
                    >
                      บันทึก
                    </button>
                    <button type="button" className="v5-btn" onClick={() => setEditingId(null)}>
                      ยกเลิก
                    </button>
                  </div>
                </form>
              ) : (
                <div className="speaker-actions">
                  <button
                    type="button"
                    className="v5-btn"
                    onClick={() => {
                      setEditingId(sp.id);
                      setNameValue(sp.name || '');
                      setRemember(!!saved);
                    }}
                  >
                    {sp.name ? 'แก้ชื่อ' : 'ตั้งชื่อ'}
                  </button>
                  {saved && (
                    <button type="button" className="v5-btn danger" onClick={() => void forget(saved)}>
                      ลืมเสียง
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
