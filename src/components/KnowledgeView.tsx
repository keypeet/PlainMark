import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Circle,
  ExternalLink,
  Plus,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react';
import {
  apiCreateKnowledge,
  apiDeleteKnowledge,
  apiListKnowledge,
  apiMoveItem,
  apiUpdateKnowledge,
  type KnowledgeItem
} from '../lib/api';
import { useNotesStore } from '../store/notesStore';

interface KnowledgeViewProps {
  onNotice: (msg: string) => void;
}

const REASON_CHIPS = ['ใช้อ้างอิง', 'ไอเดียต่อยอด', 'ต้องลองทำ', 'เก็บไว้อ่าน'];

export function KnowledgeView({ onNotice }: KnowledgeViewProps) {
  const { activeScope, projects } = useNotesStore();

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRead, setFilterRead] = useState<'all' | 'unread' | 'read'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Quick Capture form
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState(REASON_CHIPS[0]);
  const [summary, setSummary] = useState('');
  const [targetScope, setTargetScope] = useState<string>(
    activeScope === 'all' ? 'general' : activeScope
  );

  useEffect(() => {
    setTargetScope(activeScope === 'all' ? 'general' : activeScope);
  }, [activeScope]);

  const loadKnowledge = useCallback(async () => {
    setLoading(true);
    try {
      const readParam =
        filterRead === 'all' ? undefined : filterRead === 'read';
      const res = await apiListKnowledge(activeScope, { read: readParam });
      setItems(res.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeScope, filterRead]);

  useEffect(() => {
    void loadKnowledge();
  }, [loadKnowledge]);

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() && !title.trim()) return;
    try {
      const created = await apiCreateKnowledge({
        scope: targetScope,
        url: url.trim(),
        title: title.trim() || url.trim(),
        reason: reason.trim(),
        summary: summary.trim(),
        sourceType: url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube' : 'web'
      });
      setUrl('');
      setTitle('');
      setSummary('');
      onNotice(`บันทึก "${created.title}" ลงคลังความรู้แล้ว`);
      await loadKnowledge();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'บันทึกลิงก์ไม่สำเร็จ');
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter(
      (k) =>
        !q ||
        k.title.toLowerCase().includes(q) ||
        k.url.toLowerCase().includes(q) ||
        k.reason.toLowerCase().includes(q) ||
        k.summary.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, KnowledgeItem[]>();
    for (const item of filteredItems) {
      const d = item.date || new Date(item.createdAt || Date.now()).toISOString().slice(0, 10);
      const list = groups.get(d) || [];
      list.push(item);
      groups.set(d, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredItems]);

  return (
    <div className="v5-scroll-page" data-testid="knowledge-view">
      <div className="knowledge-container">
        {/* Clean Quick Capture Card (max-width 960px) */}
        <form className="knowledge-capture-card" onSubmit={(e) => void handleCapture(e)}>
          <div className="sticky-board-header">
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>เก็บความรู้และลิงก์น่าสนใจ</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>
                บันทึกลง <code>general/knowledge/</code> หรือ <code>projects/&lt;slug&gt;/knowledge/</code> (พร้อมเชื่อม Scraper &amp; Daily Digest ใน Phase 3)
              </span>
            </div>
          </div>

          <div className="knowledge-capture-row">
            <input
              className="settings-input"
              style={{ flex: 2 }}
              placeholder="วางลิงก์ (URL / YouTube / บทความ)…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <input
              className="settings-input"
              style={{ flex: 1.4 }}
              placeholder="ชื่อเรื่อง (ไม่บังคับ)…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="settings-select"
              aria-label="เลือกโปรเจคปลายทาง"
              value={targetScope}
              onChange={(e) => setTargetScope(e.target.value)}
            >
              <option value="general">ทั่วไป (General)</option>
              {projects
                .filter((p) => !p.hidden)
                .map((p) => (
                  <option key={p.slug} value={`project:${p.slug}`}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="knowledge-reason-row">
            <span className="muted" style={{ fontSize: 12.5 }}>เหตุผลที่เซฟ:</span>
            {REASON_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className={`knowledge-reason-chip ${reason === chip ? 'active' : ''}`}
                onClick={() => setReason(chip)}
              >
                {chip}
              </button>
            ))}
            <input
              className="settings-input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="สรุปสั้น 3 กล่อง / โน้ตย่อ…"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <button type="submit" className="v5-btn primary" disabled={!url.trim() && !title.trim()}>
              <Plus size={14} /> เก็บความรู้
            </button>
          </div>
        </form>

        {/* Filter & Search Bar */}
        <div className="meetings-filter-bar">
          <div className="v5-pill-switch">
            <button
              type="button"
              className={filterRead === 'all' ? 'active' : ''}
              onClick={() => setFilterRead('all')}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              className={filterRead === 'unread' ? 'active' : ''}
              onClick={() => setFilterRead('unread')}
            >
              ยังไม่อ่าน
            </button>
            <button
              type="button"
              className={filterRead === 'read' ? 'active' : ''}
              onClick={() => setFilterRead('read')}
            >
              อ่านแล้ว
            </button>
          </div>

          <div className="notes-search-box" style={{ minWidth: 240 }}>
            <Search size={14} />
            <input
              aria-label="ค้นหาความรู้"
              placeholder="ค้นหาชื่อเรื่อง เหตุผล หรือ URL…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Day-Badge Grouped List or Real Empty State */}
        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>กำลังโหลดคลังความรู้…</p>
        ) : groupedByDate.length === 0 ? (
          <div className="insights-card meetings-empty-state">
            <BookOpen size={28} style={{ color: 'var(--ink-3)' }} />
            <h3 style={{ margin: '8px 0 4px' }}>ยังไม่มีความรู้ที่บันทึกไว้</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              วางลิงก์หรือชื่อเรื่องด้านบนเพื่อเริ่มสะสมคลังความรู้รายวัน
            </p>
          </div>
        ) : (
          <div className="knowledge-days-stack">
            {groupedByDate.map(([day, dayItems]) => {
              const unreadCount = dayItems.filter((i) => !i.read).length;
              const topReasons = Array.from(
                new Set(dayItems.map((i) => i.reason).filter(Boolean))
              ).slice(0, 3);
              return (
                <section key={day} className="knowledge-day-group">
                  <div className="knowledge-day-header">
                    <span className="k-day-badge">{day}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {dayItems.length} รายการ · ยังไม่อ่าน {unreadCount}
                    </span>
                  </div>

                  {/* Daily Interest Summary Box */}
                  <div className="knowledge-day-summary">
                    <Sparkles size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span>
                      ความสนใจของวัน {day}: เก็บ {dayItems.length} เรื่อง
                      {topReasons.length > 0 ? ` · แนวโน้ม: ${topReasons.join(', ')}` : ''}
                    </span>
                  </div>

                  <div className="knowledge-items-grid">
                    {dayItems.map((item) => (
                      <article
                        key={item.id}
                        className={`knowledge-item-card ${item.read ? 'is-read' : ''}`}
                      >
                        <div className="knowledge-item-top">
                          <button
                            type="button"
                            className="note-mini-icon-btn"
                            title={item.read ? 'ทำเครื่องหมายยังไม่อ่าน' : 'ทำเครื่องหมายอ่านแล้ว'}
                            onClick={() => {
                              void apiUpdateKnowledge(item.id, { read: !item.read }).then(() => {
                                setItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id ? { ...x, read: !item.read } : x
                                  )
                                );
                              });
                            }}
                          >
                            {item.read ? (
                              <CheckCircle2 size={16} style={{ color: 'var(--ok)' }} />
                            ) : (
                              <Circle size={16} />
                            )}
                          </button>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong className="knowledge-item-title">{item.title}</strong>
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="knowledge-item-url"
                              >
                                <ExternalLink size={11} /> {item.url}
                              </a>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <select
                              className="settings-select"
                              style={{ height: 26, fontSize: 11.5 }}
                              value={item.scope}
                              title="ย้ายไปโปรเจคอื่น"
                              onChange={(e) => {
                                const nextScope = e.target.value;
                                void apiMoveItem('knowledge', item.id, nextScope).then(() => {
                                  onNotice('ย้ายรายการความรู้แล้ว');
                                  void loadKnowledge();
                                });
                              }}
                            >
                              <option value="general">ทั่วไป</option>
                              {projects.map((p) => (
                                <option key={p.slug} value={`project:${p.slug}`}>
                                  {p.name}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              className="note-mini-icon-btn"
                              title="ลบ"
                              onClick={() => {
                                void apiDeleteKnowledge(item.id).then(() => {
                                  setItems((prev) => prev.filter((x) => x.id !== item.id));
                                  onNotice('ลบรายการความรู้แล้ว');
                                });
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="knowledge-item-meta">
                          {item.reason && (
                            <span className="knowledge-reason-pill">{item.reason}</span>
                          )}
                          <span className="rail-count">{item.sourceType || 'web'}</span>
                        </div>

                        {item.summary && (
                          <div className="knowledge-summary-box">{item.summary}</div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
