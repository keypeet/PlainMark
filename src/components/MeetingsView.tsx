import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Edit3,
  History,
  Image as ImageIcon,
  Lock,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Video,
  Volume2,
  X
} from 'lucide-react';
import {
  apiCreateMeeting,
  apiCreateVoiceprint,
  apiDeleteMeeting,
  apiDeleteMeetingKeyframe,
  apiDeleteVoiceprint,
  apiGetMeeting,
  apiListContacts,
  apiListMeetingHistory,
  apiListMeetings,
  apiListVoiceprints,
  apiRenameMeetingSpeaker,
  apiRerunKeyframeOcr,
  apiUpdateMeeting,
  apiUpdateMeetingTranscript,
  type ContactItem,
  type MeetingHistorySnapshot,
  type MeetingKeyframe,
  type MeetingParticipant,
  type MeetingRecord,
  type VoiceprintItem
} from '../lib/api';
import { useNotesStore } from '../store/notesStore';
import {
  captureFileName,
  copyImageToClipboard,
  MeetingCapturePanel
} from './MeetingCapturePanel';

interface MeetingsViewProps {
  onNotice: (msg: string) => void;
}

const PAGE_SIZE = 20;

export function ocrBadge(kf: MeetingKeyframe): { label: string; tone: 'inbox' | 'local' | 'shareable' } {
  switch (kf.ocrStatus) {
    case 'done':
      return kf.ocrText ? { label: 'อ่านแล้ว', tone: 'shareable' } : { label: 'ไม่พบข้อความ', tone: 'local' };
    case 'unavailable':
      return { label: 'ยังไม่ได้ติดตั้งตัวอ่าน', tone: 'inbox' };
    case 'failed':
      return { label: 'อ่านไม่สำเร็จ', tone: 'inbox' };
    default:
      return { label: 'รออ่านข้อความ', tone: 'inbox' };
  }
}

export function MeetingsView({ onNotice }: MeetingsViewProps) {
  const { activeScope, projects } = useNotesStore();

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [inboxItems, setInboxItems] = useState<MeetingRecord[]>([]);
  const [brokenItems, setBrokenItems] = useState<MeetingRecord[]>([]);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'local_only' | 'shareable' | 'has_tasks'>('all');
  const [loading, setLoading] = useState(true);

  const [voiceprints, setVoiceprints] = useState<VoiceprintItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  // Detail Level 2 state
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingRecord | null>(null);
  const [historySnapshots, setHistorySnapshots] = useState<MeetingHistorySnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [rightWidth, setRightWidth] = useState(360);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<'summary' | 'slides'>('summary');
  const [lightboxSlide, setLightboxSlide] = useState<MeetingKeyframe | null>(null);
  const [editingSegIdx, setEditingSegIdx] = useState<number | null>(null);
  const [editingSegText, setEditingSegText] = useState('');
  const [renameSpeakerId, setRenameSpeakerId] = useState<string | null>(null);
  const [renameSpeakerValue, setRenameSpeakerValue] = useState('');
  const [inlineFeedback, setInlineFeedback] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newStartTime, setNewStartTime] = useState('09:30');
  const [newEndTime, setNewEndTime] = useState('10:30');
  const [newTitle, setNewTitle] = useState('');
  const [newVisibility, setNewVisibility] = useState<'local_only' | 'shareable'>('local_only');
  const [selectedParticipants, setSelectedParticipants] = useState<MeetingParticipant[]>([]);
  const [manualParticipantInput, setManualParticipantInput] = useState('');
  const [vpName, setVpName] = useState('');
  const [vpNick, setVpNick] = useState('');

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiListMeetings(activeScope, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        q: searchQuery.trim() || undefined
      });
      setMeetings(res.items || []);
      setTotal(res.total || 0);
      setInboxItems(res.inboxItems || []);
      setBrokenItems(res.brokenItems || []);
    } catch {
      setMeetings([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeScope, page, searchQuery]);

  const loadSupporting = useCallback(async () => {
    try {
      const [vpRes, cRes] = await Promise.all([apiListVoiceprints(), apiListContacts()]);
      setVoiceprints(vpRes.voiceprints || []);
      setContacts(cRes.contacts || []);
    } catch {
      // ignore if offline
    }
  }, []);

  useEffect(() => {
    setPage(0);
  }, [activeScope, searchQuery]);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    void loadSupporting();
  }, [loadSupporting]);

  const openMeetingDetail = async (item: MeetingRecord) => {
    if (item.bucket === 'inbox' || item.bucket === 'broken') {
      setSelectedMeeting(item);
      setHistorySnapshots([]);
      return;
    }
    try {
      const full = await apiGetMeeting(item.id);
      setSelectedMeeting(full);
      setRightTab('summary');
      const hist = await apiListMeetingHistory(item.id).catch(() => ({ snapshots: [] }));
      setHistorySnapshots(hist.snapshots || []);
    } catch {
      onNotice('เปิดรายละเอียดประชุมไม่สำเร็จ');
    }
  };

  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (filterMode === 'local_only') return m.visibility === 'local_only';
      if (filterMode === 'shareable') return m.visibility === 'shareable';
      if (filterMode === 'has_tasks') return (m.actionItems || []).some((a) => !a.done);
      return true;
    });
  }, [filterMode, meetings]);

  const openActionCount = useMemo(
    () =>
      meetings.reduce(
        (sum, m) => sum + (m.actionItems || []).filter((a) => !a.done).length,
        0
      ),
    [meetings]
  );

  const handleAddManualParticipants = () => {
    const raw = manualParticipantInput.trim();
    if (!raw) return;
    const tokens = raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const added: MeetingParticipant[] = tokens.map((tok) => {
      const isEmail = tok.includes('@');
      return isEmail ? { name: tok.split('@')[0], email: tok } : { name: tok };
    });
    setSelectedParticipants((prev) => [...prev, ...added]);
    setManualParticipantInput('');
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetScope = activeScope === 'all' ? 'general' : activeScope;
    try {
      const created = await apiCreateMeeting({
        scope: targetScope,
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime,
        title: newTitle.trim(),
        visibility: newVisibility,
        participants: selectedParticipants
      });
      setCreateOpen(false);
      setNewTitle('');
      setSelectedParticipants([]);
      onNotice(`สร้างบันทึกประชุม "${created.title}" แล้ว`);
      await loadMeetings();
      setSelectedMeeting(created);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'สร้างประชุมไม่สำเร็จ');
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      setRightWidth(Math.min(620, Math.max(280, startW + delta)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleSaveSegment = async (idx: number) => {
    if (!selectedMeeting) return;
    const segments = [...(selectedMeeting.segments || [])];
    segments[idx] = { ...segments[idx], text: editingSegText };
    try {
      const updated = await apiUpdateMeetingTranscript(selectedMeeting.id, segments, 'edit');
      setSelectedMeeting(updated);
      setEditingSegIdx(null);
      setInlineFeedback('บันทึกข้อความและเก็บ snapshot ลง .history/ แล้ว');
      const hist = await apiListMeetingHistory(selectedMeeting.id).catch(() => ({ snapshots: [] }));
      setHistorySnapshots(hist.snapshots || []);
    } catch {
      onNotice('บันทึกข้อความไม่สำเร็จ');
    }
  };

  const handleRenameSpeaker = async (oldSpeakerId: string) => {
    if (!selectedMeeting || !renameSpeakerValue.trim()) return;
    try {
      const updated = await apiRenameMeetingSpeaker(
        selectedMeeting.id,
        oldSpeakerId,
        renameSpeakerValue.trim()
      );
      setSelectedMeeting(updated);
      setRenameSpeakerId(null);
      setRenameSpeakerValue('');
      setInlineFeedback('เปลี่ยนชื่อผู้พูดและบันทึก snapshot แล้ว');
      const hist = await apiListMeetingHistory(selectedMeeting.id).catch(() => ({ snapshots: [] }));
      setHistorySnapshots(hist.snapshots || []);
    } catch {
      onNotice('เปลี่ยนชื่อผู้พูดไม่สำเร็จ');
    }
  };

  // ---------- Level 2: Detail View ----------
  if (selectedMeeting) {
    const keyframes = selectedMeeting.keyframes || [];
    const hasSlides = keyframes.length > 0;
    const hasVideo = !!selectedMeeting.videoPath;
    const seekVideo = (sec: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = sec;
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const isInbox = selectedMeeting.bucket === 'inbox';

    return (
      <div className="v5-scroll-page" data-testid="meeting-detail-view">
        <div className="meetings-detail-topbar">
          <button
            type="button"
            className="v5-btn"
            onClick={() => {
              setSelectedMeeting(null);
              setInlineFeedback('');
              void loadMeetings();
            }}
          >
            <ArrowLeft size={14} /> กลับหน้ารวมประชุม
          </button>

          <div className="meetings-detail-meta">
            <h2 style={{ margin: 0, fontSize: 16 }}>{selectedMeeting.title}</h2>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {selectedMeeting.date} {selectedMeeting.startTime}
              {selectedMeeting.endTime ? `–${selectedMeeting.endTime}` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isInbox ? (
              <span className="meeting-badge inbox">ยังไม่ระบุโปรเจค</span>
            ) : (
              <button
                type="button"
                className={`meeting-badge ${selectedMeeting.visibility === 'shareable' ? 'shareable' : 'local'}`}
                onClick={() => {
                  const nextVis =
                    selectedMeeting.visibility === 'local_only' ? 'shareable' : 'local_only';
                  void apiUpdateMeeting(selectedMeeting.id, { visibility: nextVis }).then((u) => {
                    setSelectedMeeting(u);
                    setInlineFeedback(
                      nextVis === 'local_only'
                        ? 'ตั้งเป็น local_only (ไม่ส่งออก Cloud CLI)'
                        : 'ตั้งเป็น shareable แล้ว'
                    );
                  });
                }}
              >
                {selectedMeeting.visibility === 'local_only' ? (
                  <>
                    <Lock size={12} /> local_only
                  </>
                ) : (
                  <>
                    <Share2 size={12} /> shareable
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              className="v5-btn"
              onClick={() => setRightCollapsed((c) => !c)}
            >
              {rightCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
              {rightCollapsed ? 'เปิดแถบสรุป' : 'ซ่อนแถบสรุป'}
            </button>

            {!isInbox && (
              <button
                type="button"
                className="v5-btn danger"
                onClick={() => {
                  void apiDeleteMeeting(selectedMeeting.id).then(() => {
                    setSelectedMeeting(null);
                    onNotice('ลบบันทึกประชุมแล้ว');
                    void loadMeetings();
                  });
                }}
              >
                <Trash2 size={14} /> ลบ
              </button>
            )}
          </div>
        </div>

        {inlineFeedback && <div className="meetings-inline-feedback">{inlineFeedback}</div>}

        {isInbox && (
          <div className="meetings-inbox-confirm-bar">
            <div>
              <strong>ไฟล์อัดใหม่รอยืนยัน ({selectedMeeting.id})</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                หลักฐานจากไฟล์ใน <code>general/meetings/inbox/</code> — เลือกปลายทางใน Phase 2.5
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="v5-btn primary"
                onClick={() => onNotice('ยืนยันย้ายเข้าโปรเจค (พร้อมเชื่อม pipeline Phase 2.5)')}
              >
                ยืนยันเข้าโปรเจค
              </button>
              <button
                type="button"
                className="v5-btn"
                onClick={() => onNotice('ยืนยันเข้าทั่วไป (General)')}
              >
                เก็บในทั่วไป
              </button>
              <button
                type="button"
                className="v5-btn"
                onClick={() => setSelectedMeeting(null)}
              >
                เก็บไว้ในกล่องรับก่อน
              </button>
            </div>
          </div>
        )}

        {selectedMeeting.errorState && (
          <div className="meetings-error-card">
            <AlertTriangle size={16} />
            <div style={{ flex: 1 }}>
              <strong>{selectedMeeting.errorState.message}</strong>
              {selectedMeeting.errorState.detail && (
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {selectedMeeting.errorState.detail}
                </div>
              )}
            </div>
            {selectedMeeting.errorState.canResume && (
              <button
                type="button"
                className="v5-btn primary"
                onClick={() => onNotice('พร้อม Resume ASR จากจุดล่าสุดใน Phase 2')}
              >
                <RefreshCw size={13} /> ทำต่อจากจุดเดิม
              </button>
            )}
          </div>
        )}

        <MeetingCapturePanel
          key={selectedMeeting.id}
          meeting={selectedMeeting}
          videoRef={videoRef}
          onMeetingChange={setSelectedMeeting}
          onNotice={onNotice}
        />

        {/* Audio-Only vs Keyframes 16:9 Strip (a linked video plays its own audio) */}
        {!hasSlides && hasVideo ? null : !hasSlides ? (
          <div className="meetings-audio-bar" data-testid="audio-only-player">
            <Volume2 size={16} />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 13.5 }}>โหมดเสียงล้วน (Audio-Only)</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                ไม่มีสไลด์ในบันทึกนี้ — ซ่อนแถบ Keyframes 16:9 อัตโนมัติ
              </div>
            </div>
            {selectedMeeting.audioUrl ? (
              <audio controls src={selectedMeeting.audioUrl} style={{ height: 32 }} />
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>รอไฟล์เสียง / ASR Phase 2</span>
            )}
          </div>
        ) : (
          <div className="meetings-keyframes-strip" data-testid="keyframes-strip">
            {keyframes.map((kf, idx) => (
              <div key={kf.id || idx} className="keyframe-thumb-card">
                <button
                  type="button"
                  className="keyframe-16x9"
                  title="ดูภาพขนาดใหญ่"
                  onClick={() => setLightboxSlide(kf)}
                >
                  {kf.imageUrl ? (
                    <img src={kf.imageUrl} alt={kf.caption || `สไลด์ ${idx + 1}`} />
                  ) : (
                    <ImageIcon size={20} />
                  )}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {kf.timestamp || `#${idx + 1}`} {kf.caption ? `· ${kf.caption}` : ''}
                  </span>
                  {kf.kind === 'ocr' && (
                    <span
                      className={`meeting-badge ${ocrBadge(kf).tone}`}
                      title={kf.ocrError || undefined}
                    >
                      {ocrBadge(kf).label}
                    </span>
                  )}
                </div>
                {kf.imageUrl && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                    {hasVideo && typeof kf.timeSec === 'number' && (
                      <button
                        type="button"
                        className="note-mini-icon-btn"
                        aria-label="ไปยังจังหวะนี้ในวิดีโอ"
                        title="ไปยังจังหวะนี้ในวิดีโอ"
                        onClick={() => seekVideo(kf.timeSec ?? 0)}
                      >
                        <Play size={16} />
                      </button>
                    )}
                    {kf.kind === 'ocr' && kf.id && (kf.ocrStatus !== 'done' || !kf.ocrText) && (
                      <button
                        type="button"
                        className="note-mini-icon-btn"
                        aria-label="อ่านข้อความอีกครั้ง"
                        title="อ่านข้อความอีกครั้ง"
                        onClick={() => {
                          void apiRerunKeyframeOcr(selectedMeeting.id, kf.id || '')
                            .then(setSelectedMeeting)
                            .catch(() => onNotice('อ่านข้อความไม่สำเร็จ'));
                        }}
                      >
                        <RefreshCw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      aria-label="คัดลอกรูป"
                      title="คัดลอกรูป"
                      onClick={() => {
                        void copyImageToClipboard(kf.imageUrl || '')
                          .then(() => onNotice('คัดลอกรูปแล้ว วางในแอปอื่นได้เลย'))
                          .catch(() => onNotice('คัดลอกรูปไม่สำเร็จ ลองกดดาวน์โหลดแทน'));
                      }}
                    >
                      <Copy size={16} />
                    </button>
                    <a
                      className="note-mini-icon-btn"
                      href={kf.imageUrl}
                      download={captureFileName(selectedMeeting.title, kf)}
                      aria-label="ดาวน์โหลดรูป"
                      title="ดาวน์โหลดรูป"
                    >
                      <Download size={16} />
                    </a>
                    {kf.id && (
                      <button
                        type="button"
                        className="note-mini-icon-btn"
                        aria-label="ลบรูปนี้"
                        title="ลบรูปนี้"
                        onClick={() => {
                          void apiDeleteMeetingKeyframe(selectedMeeting.id, kf.id || '')
                            .then(setSelectedMeeting)
                            .catch(() => onNotice('ลบรูปไม่สำเร็จ'));
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="meetings-detail-split">
          {/* Left Card: Transcript & Speakers */}
          <div className="meetings-card-pane">
            <div className="sticky-board-header">
              <strong>ถอดความ &amp; ผู้พูด ({selectedMeeting.segments?.length || 0} ช่วง)</strong>
              <button
                type="button"
                className="v5-btn"
                onClick={() => setShowHistory((s) => !s)}
              >
                <History size={13} /> ประวัติแก้ไข ({historySnapshots.length})
              </button>
            </div>

            {showHistory && (
              <div className="meetings-history-box">
                <strong>Snapshot ใน .history/</strong>
                {historySnapshots.length === 0 ? (
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
                    ยังไม่มีประวัติการแก้ไข (จะสร้างอัตโนมัติเมื่อแก้คำหรือเปลี่ยนชื่อผู้พูด)
                  </p>
                ) : (
                  <ul className="insights-mini-list">
                    {historySnapshots.map((h) => (
                      <li key={h.name} style={{ fontSize: 12.5 }}>
                        <code>{h.name}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {(selectedMeeting.segments?.length || 0) === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                ยังไม่มีข้อความถอดความ — รองรับการเชื่อมต่อ ASR ใน Phase 2
              </p>
            ) : (
              <div className="meetings-transcript-list">
                {selectedMeeting.segments!.map((seg, idx) => {
                  const spkId = seg.speakerId || seg.speaker || 'spk_0';
                  const spkLabel = seg.speakerName || seg.speaker || spkId;
                  return (
                    <div key={seg.id || idx} className="transcript-seg-row">
                      <div className="transcript-seg-head">
                        {renameSpeakerId === spkId ? (
                          <span style={{ display: 'inline-flex', gap: 4 }}>
                            <input
                              className="settings-input"
                              style={{ height: 26, padding: '0 8px' }}
                              value={renameSpeakerValue}
                              onChange={(e) => setRenameSpeakerValue(e.target.value)}
                            />
                            <button
                              type="button"
                              className="v5-btn primary"
                              style={{ height: 26, padding: '0 8px', fontSize: 12 }}
                              onClick={() => void handleRenameSpeaker(spkId)}
                            >
                              บันทึก
                            </button>
                            <button
                              type="button"
                              className="v5-btn"
                              style={{ height: 26, padding: '0 8px', fontSize: 12 }}
                              onClick={() => setRenameSpeakerId(null)}
                            >
                              ยกเลิก
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="speaker-pill-btn"
                            title="คลิกเพื่อเปลี่ยนชื่อผู้พูด"
                            onClick={() => {
                              setRenameSpeakerId(spkId);
                              setRenameSpeakerValue(spkLabel);
                            }}
                          >
                            <UserCheck size={12} /> {spkLabel}
                          </button>
                        )}
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {seg.timestamp || ''}
                        </span>
                        <button
                          type="button"
                          className="note-mini-icon-btn"
                          title="แก้ไขข้อความช่วงนี้"
                          onClick={() => {
                            setEditingSegIdx(idx);
                            setEditingSegText(seg.text);
                          }}
                        >
                          <Edit3 size={12} />
                        </button>
                      </div>

                      {editingSegIdx === idx ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <textarea
                            className="sticky-edit-input"
                            value={editingSegText}
                            onChange={(e) => setEditingSegText(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="v5-btn primary"
                              style={{ height: 28, fontSize: 12 }}
                              onClick={() => void handleSaveSegment(idx)}
                            >
                              บันทึกข้อความ
                            </button>
                            <button
                              type="button"
                              className="v5-btn"
                              style={{ height: 28, fontSize: 12 }}
                              onClick={() => setEditingSegIdx(null)}
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="transcript-seg-text">{seg.text}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resizable Right Panel */}
          {!rightCollapsed && (
            <>
              <div
                className="meetings-resize-handle"
                title="ลากเพื่อปรับความกว้าง (280–620px)"
                onPointerDown={handleResizePointerDown}
              />
              <div className="meetings-card-pane" style={{ width: `${rightWidth}px`, flexShrink: 0 }}>
                <div className="sticky-board-header">
                  <div className="v5-pill-switch">
                    <button
                      type="button"
                      className={rightTab === 'summary' ? 'active' : ''}
                      onClick={() => setRightTab('summary')}
                    >
                      สรุป &amp; งานค้าง
                    </button>
                    {hasSlides && (
                      <button
                        type="button"
                        className={rightTab === 'slides' ? 'active' : ''}
                        onClick={() => setRightTab('slides')}
                      >
                        สไลด์ ({keyframes.length})
                      </button>
                    )}
                  </div>
                </div>

                {rightTab === 'summary' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>สรุปสาระสำคัญ</strong>
                      <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.55 }}>
                        {selectedMeeting.summary || 'ยังไม่มีสรุปประชุม'}
                      </p>
                    </div>
                    <div>
                      <strong style={{ fontSize: 13 }}>
                        งานค้าง ({selectedMeeting.actionItems?.length || 0})
                      </strong>
                      {(selectedMeeting.actionItems?.length || 0) === 0 ? (
                        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
                          ยังไม่มีงานค้าง
                        </p>
                      ) : (
                        <ul className="insights-mini-list">
                          {selectedMeeting.actionItems!.map((a, i) => (
                            <li key={a.id || i}>
                              <span>{a.text}</span>
                              {a.assignee && (
                                <span className="muted" style={{ fontSize: 11.5 }}>
                                  {' '}
                                  · {a.assignee}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <strong style={{ fontSize: 13 }}>
                        ผู้เข้าร่วม ({selectedMeeting.participants?.length || 0})
                      </strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {(selectedMeeting.participants || []).map((p, i) => (
                          <span key={i} className="rail-count">
                            {p.name || p.email}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {keyframes.map((kf, i) => (
                      <button
                        key={kf.id || i}
                        type="button"
                        className="sticky-picker-item"
                        onClick={() => setLightboxSlide(kf)}
                      >
                        <strong>{kf.caption || `สไลด์ #${i + 1}`}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {kf.ocrText ? kf.ocrText.slice(0, 80) : kf.timestamp || ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Slide Lightbox 16:9 (max-width 920px) */}
        {lightboxSlide && (
          <div className="v5-modal-backdrop" onClick={() => setLightboxSlide(null)}>
            <div
              className="v5-modal slide-lightbox-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="v5-modal-head">
                <h3>{lightboxSlide.caption || 'พรีวิวสไลด์ 16:9'}</h3>
                <button
                  type="button"
                  className="note-mini-icon-btn"
                  onClick={() => setLightboxSlide(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="slide-lightbox-16x9">
                {lightboxSlide.imageUrl ? (
                  <img src={lightboxSlide.imageUrl} alt={lightboxSlide.caption || 'Slide'} />
                ) : (
                  <div className="muted">ไม่มีภาพพรีวิว</div>
                )}
              </div>
              {lightboxSlide.ocrText && (
                <div className="meetings-history-box">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong>ข้อความที่อ่านได้</strong>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      aria-label="คัดลอกข้อความ"
                      title="คัดลอกข้อความ"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(lightboxSlide.ocrText || '')
                          .then(() => onNotice('คัดลอกข้อความแล้ว'))
                          .catch(() => onNotice('คัดลอกข้อความไม่สำเร็จ'));
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{lightboxSlide.ocrText}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- Level 1: Folder Hub ----------
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="v5-scroll-page" data-testid="meetings-hub-view">
      <div className="meetings-container">
        <div className="meetings-hub-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>บันทึกประชุม (Meetings)</h2>
            <span className="muted" style={{ fontSize: 13 }}>
              เริ่มต้นเป็น <code>local_only</code> เสมอ · รองรับรายการ 200+ ด้วย Pagination
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="v5-btn" onClick={() => setVoiceModalOpen(true)}>
              <Mic size={14} /> คลังเสียง ({voiceprints.length})
            </button>
            <button type="button" className="v5-btn primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> + เพิ่มประชุม
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="insights-stats-grid">
          <div className="insights-stat-card">
            <span className="insights-stat-icon teal">
              <Video size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{total}</strong>
              <span>ประชุมทั้งหมด</span>
            </div>
          </div>
          <div className="insights-stat-card">
            <span className="insights-stat-icon rose">
              <Clock size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{openActionCount}</strong>
              <span>งานค้าง (หน้านี้)</span>
            </div>
          </div>
          <div className="insights-stat-card">
            <span className="insights-stat-icon indigo">
              <Users size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{voiceprints.length}</strong>
              <span>เสียงผู้พูดที่จำได้</span>
            </div>
          </div>
        </div>

        {/* Plan 2.5 Slots: inbox/ & broken/ */}
        {inboxItems.length > 0 && (
          <div className="meetings-inbox-confirm-bar">
            <div>
              <strong>อัดใหม่ {inboxItems.length} รายการ — รอยืนยัน</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                พบไฟล์ใน <code>general/meetings/inbox/</code> (ยังไม่รวมในยอดประชุมหรือ source_hash)
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {inboxItems.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="v5-btn primary"
                  onClick={() => void openMeetingDetail(item)}
                >
                  ตรวจหลักฐาน: {item.title || item.id}
                </button>
              ))}
            </div>
          </div>
        )}

        {brokenItems.length > 0 && (
          <div className="meetings-error-card">
            <AlertTriangle size={16} />
            <div>
              <strong>พบไฟล์อัดไม่สมบูรณ์ {brokenItems.length} รายการใน broken/</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {brokenItems.map((b) => b.title || b.id).join(', ')}
              </div>
            </div>
          </div>
        )}

        {/* Filter & Controlled Search */}
        <div className="meetings-filter-bar">
          <div className="v5-pill-switch">
            <button
              type="button"
              className={filterMode === 'all' ? 'active' : ''}
              onClick={() => setFilterMode('all')}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              className={filterMode === 'local_only' ? 'active' : ''}
              onClick={() => setFilterMode('local_only')}
            >
              เฉพาะในเครื่อง
            </button>
            <button
              type="button"
              className={filterMode === 'shareable' ? 'active' : ''}
              onClick={() => setFilterMode('shareable')}
            >
              แชร์ได้
            </button>
            <button
              type="button"
              className={filterMode === 'has_tasks' ? 'active' : ''}
              onClick={() => setFilterMode('has_tasks')}
            >
              มีงานค้าง
            </button>
          </div>

          <div className="notes-search-box" style={{ minWidth: 240 }}>
            <Search size={14} />
            <input
              aria-label="ค้นหาประชุม"
              placeholder="ค้นหาชื่อเรื่อง สรุป หรือวันที่…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* List or Real Empty State */}
        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>กำลังโหลดรายการประชุม…</p>
        ) : filteredMeetings.length === 0 ? (
          <div className="insights-card meetings-empty-state">
            <Video size={28} style={{ color: 'var(--ink-3)' }} />
            <h3 style={{ margin: '8px 0 4px' }}>ยังไม่มีบันทึกประชุมในขอบเขตนี้</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              กด <strong>+ เพิ่มประชุม</strong> เพื่อสร้างบันทึกวันเวลาและผู้เข้าร่วมจากดิสก์จริง (ไม่พึ่ง Google OAuth)
            </p>
          </div>
        ) : (
          <div className="meetings-list-stack">
            {filteredMeetings.map((m) => (
              <button
                key={m.id}
                type="button"
                className="meeting-row-card"
                onClick={() => void openMeetingDetail(m)}
              >
                <div className="meeting-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{m.title}</strong>
                    <span className={`meeting-badge ${m.visibility === 'shareable' ? 'shareable' : 'local'}`}>
                      {m.visibility === 'local_only' ? 'local_only' : 'shareable'}
                    </span>
                    <span className="rail-count">{m.scope}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    <Calendar size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                    {m.date} {m.startTime}
                    {m.summary ? ` · ${m.summary.slice(0, 90)}` : ''}
                  </div>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {(m.participants || []).length} คน
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="meetings-pagination">
            <button
              type="button"
              className="v5-btn"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={14} /> ก่อนหน้า
            </button>
            <span className="muted" style={{ fontSize: 12.5 }}>
              หน้า {page + 1} / {totalPages} (ทั้งหมด {total} รายการ)
            </span>
            <button
              type="button"
              className="v5-btn"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Create Meeting Modal (Date/Time first, title optional, offline contacts) */}
      {createOpen && (
        <div className="v5-modal-backdrop" onClick={() => setCreateOpen(false)}>
          <form
            className="v5-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void handleCreateMeeting(e)}
          >
            <div className="v5-modal-head">
              <h3>เพิ่มบันทึกประชุมใหม่</h3>
              <button
                type="button"
                className="note-mini-icon-btn"
                onClick={() => setCreateOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="meetings-form-row">
              <div className="v5-field" style={{ flex: 1 }}>
                <label>วันที่ประชุม</label>
                <input
                  type="date"
                  className="settings-input"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  required
                />
              </div>
              <div className="v5-field" style={{ width: 110 }}>
                <label>เวลาเริ่ม</label>
                <input
                  type="time"
                  className="settings-input"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="v5-field" style={{ width: 110 }}>
                <label>เวลาจบ</label>
                <input
                  type="time"
                  className="settings-input"
                  value={newEndTime}
                  onChange={(e) => setNewEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="v5-field">
              <label>หัวข้อประชุม (ไม่บังคับ — เว้นว่างจะตั้งจากวันเวลาให้อัตโนมัติ)</label>
              <input
                className="settings-input"
                placeholder="เช่น Daily Sync, คุยงานลูกค้า…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>

            <div className="v5-field">
              <label>ผู้เข้าร่วม (เลือกจาก shared/contacts.json หรือพิมพ์/วางรายชื่อเอง)</label>
              {contacts.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="v5-btn"
                      style={{ height: 26, fontSize: 12, padding: '0 10px' }}
                      onClick={() =>
                        setSelectedParticipants((prev) => [
                          ...prev,
                          { name: c.name || c.email, nickname: c.nickname, email: c.email }
                        ])
                      }
                    >
                      + {c.name || c.email}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="settings-input"
                  style={{ flex: 1 }}
                  placeholder="พิมพ์ชื่อหรืออีเมลคั่นด้วย , หรือวางหลายชื่อ…"
                  value={manualParticipantInput}
                  onChange={(e) => setManualParticipantInput(e.target.value)}
                />
                <button
                  type="button"
                  className="v5-btn"
                  onClick={handleAddManualParticipants}
                >
                  <UserPlus size={13} /> เพิ่ม
                </button>
              </div>
              {selectedParticipants.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {selectedParticipants.map((p, idx) => (
                    <span key={idx} className="sticky-link-chip">
                      <span>{p.name || p.email}</span>
                      <button
                        type="button"
                        className="sticky-link-del"
                        onClick={() =>
                          setSelectedParticipants((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="v5-field">
              <label>ความเป็นส่วนตัว</label>
              <div className="v5-pill-switch" style={{ alignSelf: 'flex-start' }}>
                <button
                  type="button"
                  className={newVisibility === 'local_only' ? 'active' : ''}
                  onClick={() => setNewVisibility('local_only')}
                >
                  เฉพาะในเครื่อง (local_only)
                </button>
                <button
                  type="button"
                  className={newVisibility === 'shareable' ? 'active' : ''}
                  onClick={() => setNewVisibility('shareable')}
                >
                  แชร์ให้ AI Cloud ได้ (shareable)
                </button>
              </div>
            </div>

            <div className="v5-modal-actions">
              <button type="button" className="v5-btn" onClick={() => setCreateOpen(false)}>
                ยกเลิก
              </button>
              <button type="submit" className="v5-btn primary">
                สร้างบันทึกประชุม
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Voiceprint Directory Modal */}
      {voiceModalOpen && (
        <div className="v5-modal-backdrop" onClick={() => setVoiceModalOpen(false)}>
          <div className="v5-modal" onClick={(e) => e.stopPropagation()}>
            <div className="v5-modal-head">
              <h3>คลังเสียงผู้พูด (Voiceprints — Embedding เท่านั้น)</h3>
              <button
                type="button"
                className="note-mini-icon-btn"
                onClick={() => setVoiceModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!vpName.trim()) return;
                void apiCreateVoiceprint({
                  name: vpName.trim(),
                  nickname: vpNick.trim(),
                  embedding: []
                }).then((created) => {
                  setVoiceprints((prev) => [...prev, created]);
                  setVpName('');
                  setVpNick('');
                  onNotice(`เพิ่มเสียง ${created.name} แล้ว`);
                });
              }}
            >
              <input
                className="settings-input"
                style={{ flex: 1 }}
                placeholder="ชื่อผู้พูด…"
                value={vpName}
                onChange={(e) => setVpName(e.target.value)}
              />
              <input
                className="settings-input"
                style={{ width: 110 }}
                placeholder="ชื่อเล่น…"
                value={vpNick}
                onChange={(e) => setVpNick(e.target.value)}
              />
              <button type="submit" className="v5-btn primary">
                เพิ่ม
              </button>
            </form>

            {voiceprints.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                ยังไม่มีคลังเสียงใน <code>shared/voiceprints/</code>
              </p>
            ) : (
              <div className="sticky-link-picker-list">
                {voiceprints.map((vp) => (
                  <div key={vp.id} className="sticky-picker-item">
                    <div>
                      <strong>{vp.name}</strong>
                      {vp.nickname ? ` (${vp.nickname})` : ''}
                    </div>
                    <button
                      type="button"
                      className="v5-btn danger"
                      style={{ height: 28, fontSize: 12 }}
                      onClick={() => {
                        void apiDeleteVoiceprint(vp.id).then(() => {
                          setVoiceprints((prev) => prev.filter((x) => x.id !== vp.id));
                          onNotice(`ลบเสียง ${vp.name} (Forget Speaker) แล้ว`);
                        });
                      }}
                    >
                      Forget Speaker
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
