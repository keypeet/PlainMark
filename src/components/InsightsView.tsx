import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Video
} from 'lucide-react';
import {
  apiListKnowledge,
  apiListMeetings,
  apiSmartSync,
  type BoardAttachment,
  type InsightsDoc,
  type KnowledgeItem,
  type MeetingRecord,
  type NoteMeta,
  type SmartSyncResult
} from '../lib/api';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AppSection } from '../types';
import type { CloseReasonTarget } from './CloseReasonModal';
import { StickyBoard } from './StickyBoard';

interface InsightsViewProps {
  boardRefreshKey: number;
  onSelectSection: (section: AppSection) => void;
  onOpenNote: (note: NoteMeta) => void;
  onRequestClose: (target: CloseReasonTarget) => void;
  onNotice: (msg: string) => void;
}

export function InsightsView({
  boardRefreshKey,
  onSelectSection,
  onOpenNote,
  onRequestClose,
  onNotice
}: InsightsViewProps) {
  const { activeScope, generalNotes, projects } = useNotesStore();
  const notes = useMemo<NoteMeta[]>(() => {
    if (activeScope === 'general') return generalNotes;
    if (activeScope.startsWith('project:')) {
      const slug = activeScope.slice('project:'.length);
      return projects.find((p) => p.slug === slug)?.notes ?? [];
    }
    return [
      ...generalNotes,
      ...projects.filter((p) => !p.hidden).flatMap((p) => p.notes || [])
    ];
  }, [activeScope, generalNotes, projects]);
  const autoSyncEnabled = useSettingsStore(
    (s) => s.backendSettings?.sync?.autoSyncEnabled ?? true
  );

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncBanner, setSyncBanner] = useState('');
  const [insightsDoc, setInsightsDoc] = useState<InsightsDoc | null>(null);
  const [panelTab, setPanelTab] = useState<'all' | 'tasks' | 'unread'>('all');
  const [panelQuery, setPanelQuery] = useState('');
  const [timelineMode, setTimelineMode] = useState<'monthly' | 'yearly'>('monthly');

  const scopeTitle = useMemo(() => {
    if (activeScope === 'all') return 'ภาพรวมทุกโปรเจค';
    if (activeScope === 'general') return 'ทั่วไป (General)';
    const slug = activeScope.slice('project:'.length);
    return projects.find((p) => p.slug === slug)?.name ?? slug;
  }, [activeScope, projects]);

  const loadRealData = useCallback(async () => {
    try {
      const [mRes, kRes] = await Promise.all([
        apiListMeetings(activeScope, { limit: 100, offset: 0 }),
        apiListKnowledge(activeScope)
      ]);
      setMeetings(mRes.items || []);
      setKnowledge(kRes.items || []);
    } catch {
      setMeetings([]);
      setKnowledge([]);
    }
  }, [activeScope]);

  const runSync = useCallback(
    async (force = false) => {
      setSyncing(true);
      try {
        const res = await apiSmartSync({ scope: activeScope, force });
        const results: SmartSyncResult[] = res.results || [];
        const syncedCount = results.filter((r) => r.status === 'synced').length;
        const skippedCount = results.filter((r) => r.status === 'skipped').length;
        const firstInsights = results.find((r) => r.insights)?.insights ?? null;
        setInsightsDoc(firstInsights);
        if (syncedCount > 0) {
          setSyncBanner(`อัปเดต ${syncedCount} ขอบเขตแล้ว`);
        } else {
          setSyncBanner(`ไม่พบการเปลี่ยนแปลง (${skippedCount} ขอบเขต · 0 tokens)`);
        }
      } catch {
        setSyncBanner('ไม่สามารถเชื่อมต่อ Smart Sync ได้');
      } finally {
        setSyncing(false);
      }
    },
    [activeScope]
  );

  useEffect(() => {
    void loadRealData();
    if (autoSyncEnabled) {
      void runSync(false);
    }
  }, [autoSyncEnabled, loadRealData, runSync]);

  const openActionItems = useMemo(() => {
    const items: Array<{ id: string; text: string; sourceTitle: string; assignee?: string }> = [];
    for (const m of meetings) {
      for (const act of m.actionItems || []) {
        if (!act.done && act.text) {
          items.push({
            id: `${m.id}-${act.id || act.text}`,
            text: act.text,
            sourceTitle: m.title,
            assignee: act.assignee
          });
        }
      }
    }
    return items;
  }, [meetings]);

  const unreadKnowledge = useMemo(
    () => knowledge.filter((k) => !k.read),
    [knowledge]
  );

  const filteredTasks = useMemo(() => {
    const q = panelQuery.trim().toLowerCase();
    return openActionItems.filter(
      (t) =>
        !q ||
        t.text.toLowerCase().includes(q) ||
        t.sourceTitle.toLowerCase().includes(q) ||
        (t.assignee || '').toLowerCase().includes(q)
    );
  }, [openActionItems, panelQuery]);

  const filteredUnread = useMemo(() => {
    const q = panelQuery.trim().toLowerCase();
    return unreadKnowledge.filter(
      (k) =>
        !q ||
        k.title.toLowerCase().includes(q) ||
        k.reason.toLowerCase().includes(q) ||
        k.summary.toLowerCase().includes(q)
    );
  }, [panelQuery, unreadKnowledge]);

  const timelineBuckets = useMemo(() => {
    const buckets = new Map<string, { label: string; notes: number; meetings: number; knowledge: number }>();
    const toKey = (tsOrDate: number | string | undefined): string | null => {
      if (!tsOrDate) return null;
      if (typeof tsOrDate === 'string') {
        const clean = tsOrDate.slice(0, timelineMode === 'monthly' ? 7 : 4);
        return clean || null;
      }
      const d = new Date(tsOrDate);
      if (Number.isNaN(d.getTime())) return null;
      const y = String(d.getFullYear());
      if (timelineMode === 'yearly') return y;
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    };

    const bump = (key: string | null, field: 'notes' | 'meetings' | 'knowledge') => {
      if (!key) return;
      const cur = buckets.get(key) || { label: key, notes: 0, meetings: 0, knowledge: 0 };
      cur[field] += 1;
      buckets.set(key, cur);
    };

    for (const n of notes) bump(toKey(n.updatedAt || n.createdAt), 'notes');
    for (const m of meetings) bump(toKey(m.date || m.createdAt), 'meetings');
    for (const k of knowledge) bump(toKey(k.date || k.createdAt), 'knowledge');

    return Array.from(buckets.values()).sort((a, b) => b.label.localeCompare(a.label));
  }, [knowledge, meetings, notes, timelineMode]);

  const handleNavigateBoardLink = (link: BoardAttachment) => {
    if (link.kind === 'url') {
      window.open(link.target, '_blank', 'noopener,noreferrer');
      return;
    }
    if (link.kind === 'meeting') {
      onSelectSection('meetings');
      onNotice(`เปิดหมวดประชุม: ${link.label}`);
      return;
    }
    const found = notes.find((n) => n.path === link.target);
    if (found) {
      onOpenNote(found);
    } else {
      onNotice('ไม่พบโน้ตที่อ้างอิง');
    }
  };

  const prov = insightsDoc?.provenance;

  return (
    <div className="v5-scroll-page" data-testid="insights-view">
      <div className="insights-container">
        {/* 1. Hero Gradient Card */}
        <section className="insights-hero-card">
          <div className="insights-hero-top">
            <div>
              <div className="insights-hero-eyebrow">
                <Sparkles size={14} /> Personal AI Insights · ข้อมูลจริงจากดิสก์
              </div>
              <h2 className="insights-hero-title">{scopeTitle}</h2>
              <p className="insights-hero-sub">
                สังเคราะห์เฉพาะจากโน้ตจริง + สรุปประชุม + สรุปความรู้ (ไม่อ่าน raw transcript ซ้ำ และไม่รวมกระดาษร่าง)
              </p>
            </div>

            <div className="insights-hero-actions">
              <button
                type="button"
                className="insights-sync-btn"
                disabled={syncing}
                onClick={() => void runSync(false)}
              >
                {syncing ? (
                  <Loader2 size={14} className="spin-icon" />
                ) : (
                  <RefreshCw size={14} />
                )}
                ตรวจอีกครั้ง / อัปเดตสรุป
              </button>
              <button
                type="button"
                className="insights-sync-btn secondary"
                disabled={syncing}
                onClick={() => void runSync(true)}
              >
                บังคับสรุปใหม่
              </button>
              {syncBanner && <span className="insights-sync-result">{syncBanner}</span>}
            </div>
          </div>

          {prov && (
            <div className="insights-provenance-row">
              <span>โมเดล: {prov.provider}{prov.model ? ` / ${prov.model}` : ''}</span>
              <span>Effort: {prov.effort}</span>
              <span>อัปเดต: {prov.generated_at}</span>
              <span>Hash: {prov.source_hash.slice(0, 10)}</span>
            </div>
          )}
        </section>

        {/* 2. 4 Mini Stat Cards */}
        <section className="insights-stats-grid">
          <button
            type="button"
            className="insights-stat-card"
            onClick={() => onSelectSection('notes')}
          >
            <span className="insights-stat-icon indigo">
              <FileText size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{notes.length}</strong>
              <span>โน้ตจริง</span>
            </div>
          </button>

          <button
            type="button"
            className="insights-stat-card"
            onClick={() => onSelectSection('meetings')}
          >
            <span className="insights-stat-icon teal">
              <Video size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{meetings.length}</strong>
              <span>ประชุมยืนยันแล้ว</span>
            </div>
          </button>

          <button
            type="button"
            className="insights-stat-card"
            onClick={() => onSelectSection('knowledge')}
          >
            <span className="insights-stat-icon amber">
              <BookOpen size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{unreadKnowledge.length} / {knowledge.length}</strong>
              <span>ความรู้ยังไม่อ่าน</span>
            </div>
          </button>

          <div className="insights-stat-card">
            <span className="insights-stat-icon rose">
              <CheckSquare size={16} />
            </span>
            <div className="insights-stat-meta">
              <strong>{openActionItems.length}</strong>
              <span>งานค้างจากประชุม</span>
            </div>
          </div>
        </section>

        {/* 3. 3-Box Summary (Notes + Meeting Summary + Knowledge Summary) */}
        <section className="insights-3box-grid">
          <div className="insights-card">
            <h3>โน้ตล่าสุด</h3>
            {notes.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                ยังไม่มีโน้ตจริงในขอบเขตนี้
              </p>
            ) : (
              <ul className="insights-mini-list">
                {notes.slice(0, 4).map((n) => (
                  <li key={n.path}>
                    <button
                      type="button"
                      className="insights-link-btn"
                      onClick={() => onOpenNote(n)}
                    >
                      {n.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="insights-card">
            <h3>สรุปประชุมล่าสุด</h3>
            {meetings.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                ยังไม่มีบันทึกประชุมในขอบเขตนี้
              </p>
            ) : (
              <ul className="insights-mini-list">
                {meetings.slice(0, 3).map((m) => (
                  <li key={m.id}>
                    <strong>{m.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {m.summary ? m.summary.slice(0, 90) : `${m.date} ${m.startTime}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="insights-card">
            <h3>สรุปความรู้ที่เก็บไว้</h3>
            {knowledge.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                ยังไม่มีลิงก์ความรู้ในขอบเขตนี้
              </p>
            ) : (
              <ul className="insights-mini-list">
                {knowledge.slice(0, 3).map((k) => (
                  <li key={k.id}>
                    <strong>{k.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {k.reason || k.summary || k.date}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 4. Warm Cream "ทำต่อ" Card */}
        <section className="insights-continue-card">
          <div className="insights-continue-head">
            <h3 style={{ margin: 0, fontSize: 15 }}>ทำต่อ (Next Up)</h3>
            <span className="muted" style={{ fontSize: 12.5 }}>
              จุดเริ่มต่อจากโน้ตและงานค้างล่าสุด
            </span>
          </div>
          {notes.length === 0 && openActionItems.length === 0 && unreadKnowledge.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              ยังไม่มีรายการค้าง — เริ่มสร้างโน้ต บันทึกประชุม หรือแปะการ์ดบนกระดานได้เลย
            </p>
          ) : (
            <div className="insights-continue-chips">
              {notes.slice(0, 2).map((n) => (
                <button
                  key={n.path}
                  type="button"
                  className="v5-btn"
                  onClick={() => onOpenNote(n)}
                >
                  <FileText size={13} /> เขียนต่อ: {n.name}
                </button>
              ))}
              {openActionItems.slice(0, 2).map((act) => (
                <button
                  key={act.id}
                  type="button"
                  className="v5-btn"
                  onClick={() => onSelectSection('meetings')}
                >
                  <CheckSquare size={13} /> {act.text}
                </button>
              ))}
              {unreadKnowledge.slice(0, 1).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="v5-btn"
                  onClick={() => onSelectSection('knowledge')}
                >
                  <BookOpen size={13} /> อ่านต่อ: {k.title}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 5. Draggable Sticky Board */}
        <StickyBoard
          scope={activeScope}
          notes={notes}
          meetings={meetings}
          refreshKey={boardRefreshKey}
          onRequestClose={onRequestClose}
          onNavigateLink={handleNavigateBoardLink}
          onNotice={onNotice}
        />

        {/* 6. Open Tasks & Unread Knowledge Panel */}
        <section className="insights-card">
          <div className="sticky-board-header">
            <h2 style={{ margin: 0, fontSize: 16 }}>งานค้างและยังไม่ได้อ่าน</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="v5-pill-switch">
                <button
                  type="button"
                  className={panelTab === 'all' ? 'active' : ''}
                  onClick={() => setPanelTab('all')}
                >
                  ทั้งหมด
                </button>
                <button
                  type="button"
                  className={panelTab === 'tasks' ? 'active' : ''}
                  onClick={() => setPanelTab('tasks')}
                >
                  งานค้าง ({openActionItems.length})
                </button>
                <button
                  type="button"
                  className={panelTab === 'unread' ? 'active' : ''}
                  onClick={() => setPanelTab('unread')}
                >
                  ยังไม่อ่าน ({unreadKnowledge.length})
                </button>
              </div>
              <div className="notes-search-box" style={{ minWidth: 200 }}>
                <Search size={13} />
                <input
                  placeholder="กรองงานค้าง / ความรู้…"
                  value={panelQuery}
                  onChange={(e) => setPanelQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          {filteredTasks.length === 0 && filteredUnread.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              ไม่มีรายการที่ตรงกับตัวกรอง
            </p>
          ) : (
            <div className="insights-panel-list">
              {panelTab !== 'unread' &&
                filteredTasks.map((t) => (
                  <div key={t.id} className="insights-panel-row">
                    <div>
                      <strong>{t.text}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        จากประชุม: {t.sourceTitle}
                        {t.assignee ? ` · ผู้รับผิดชอบ: ${t.assignee}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="v5-btn"
                      onClick={() => onSelectSection('meetings')}
                    >
                      ดูประชุม
                    </button>
                  </div>
                ))}
              {panelTab !== 'tasks' &&
                filteredUnread.map((k) => (
                  <div key={k.id} className="insights-panel-row">
                    <div>
                      <strong>{k.title}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        ยังไม่อ่าน · {k.reason || k.date}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="v5-btn"
                      onClick={() => onSelectSection('knowledge')}
                    >
                      เปิดความรู้
                    </button>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* 7. Interest Timeline (Monthly / Yearly) in Overview */}
        {(activeScope === 'all' || activeScope === 'general') && (
          <section className="insights-card">
            <div className="sticky-board-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarDays size={16} />
                <h2 style={{ margin: 0, fontSize: 16 }}>ไทม์ไลน์ความสนใจและกิจกรรม</h2>
              </div>
              <div className="v5-pill-switch">
                <button
                  type="button"
                  className={timelineMode === 'monthly' ? 'active' : ''}
                  onClick={() => setTimelineMode('monthly')}
                >
                  รายเดือน
                </button>
                <button
                  type="button"
                  className={timelineMode === 'yearly' ? 'active' : ''}
                  onClick={() => setTimelineMode('yearly')}
                >
                  รายปี
                </button>
              </div>
            </div>

            {timelineBuckets.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                ยังไม่มีกิจกรรมที่มีวันที่บันทึกไว้
              </p>
            ) : (
              <div className="insights-timeline-list">
                {timelineBuckets.map((b) => (
                  <div key={b.label} className="insights-timeline-row">
                    <span className="k-day-badge">{b.label}</span>
                    <span>โน้ต {b.notes}</span>
                    <span>ประชุม {b.meetings}</span>
                    <span>ความรู้ {b.knowledge}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
