import { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2, Lock, Send, ShieldAlert, Sparkles, X } from 'lucide-react';
import { apiQueryAssistant, type AssistantQueryResponse } from '../lib/api';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';

interface AssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenNoteByPath: (path: string) => void;
}

interface ChatTurn {
  id: string;
  query: string;
  response?: AssistantQueryResponse;
  error?: string;
}

const PROVIDERS = [
  { id: 'lms', label: 'LM Studio (Local ฟรี)' },
  { id: 'claude', label: 'Claude CLI' },
  { id: 'grok', label: 'Grok CLI' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' }
];

export function AssistantDrawer({ open, onClose, onOpenNoteByPath }: AssistantDrawerProps) {
  const { activeScope, projects } = useNotesStore();
  const { backendSettings, patchBackendSettings } = useSettingsStore();

  const assistantCfg = backendSettings?.aiDefaults?.assistant;
  const [provider, setProvider] = useState(assistantCfg?.provider || 'lms');
  const [model, setModel] = useState(assistantCfg?.model || '');
  const [includeAllScopes, setIncludeAllScopes] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  useEffect(() => {
    if (assistantCfg) {
      setProvider(assistantCfg.provider || 'lms');
      setModel(assistantCfg.model || '');
    }
  }, [assistantCfg]);

  useEffect(() => {
    setIncludeAllScopes(false);
  }, [activeScope]);

  const scopeLabel = useMemo(() => {
    if (includeAllScopes || activeScope === 'all') return 'ทุกโปรเจค (ทั้งระบบ)';
    if (activeScope === 'general') return 'เฉพาะ: ทั่วไป (General)';
    const slug = activeScope.slice('project:'.length);
    const name = projects.find((p) => p.slug === slug)?.name ?? slug;
    return `เฉพาะโปรเจค: ${name}`;
  }, [activeScope, includeAllScopes, projects]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    const turnId = `turn-${Date.now()}`;
    setTurns((prev) => [...prev, { id: turnId, query: q }]);
    setLoading(true);
    try {
      const res = await apiQueryAssistant({
        query: q,
        scope: activeScope,
        includeAllScopes,
        provider,
        model
      });
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, response: res } : t)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เรียกผู้ช่วย AI ไม่สำเร็จ';
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, error: msg } : t)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="assistant-drawer" aria-label="ผู้ช่วย AI ส่วนตัว">
      <div className="assistant-drawer-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          <strong>ผู้ช่วย AI ส่วนตัว</strong>
        </div>
        <button type="button" className="note-mini-icon-btn" title="ปิดลิ้นชัก" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="assistant-controls">
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            className="settings-select"
            style={{ flex: 1 }}
            aria-label="เลือกค่าย AI"
            value={provider}
            onChange={(e) => {
              const nextProvider = e.target.value;
              setProvider(nextProvider);
              void patchBackendSettings({
                aiDefaults: {
                  assistant: {
                    provider: nextProvider,
                    model,
                    effort: assistantCfg?.effort ?? 'medium'
                  }
                }
              });
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            className="settings-input"
            style={{ width: 130 }}
            placeholder="รุ่นโมเดล…"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => {
              void patchBackendSettings({
                aiDefaults: {
                  assistant: {
                    provider,
                    model,
                    effort: assistantCfg?.effort ?? 'medium'
                  }
                }
              });
            }}
          />
        </div>

        <div className="assistant-scope-bar">
          <span className="assistant-scope-badge">
            <Lock size={12} /> {scopeLabel}
          </span>
          {activeScope !== 'all' && (
            <button
              type="button"
              className={`v5-btn ${includeAllScopes ? 'primary' : ''}`}
              style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              onClick={() => setIncludeAllScopes((v) => !v)}
            >
              <Globe size={12} /> {includeAllScopes ? 'กลับเฉพาะขอบเขตนี้' : 'ถามทั้งระบบแทน'}
            </button>
          )}
        </div>
      </div>

      <div className="assistant-messages">
        {turns.length === 0 ? (
          <div className="assistant-empty">
            <p style={{ margin: 0, fontWeight: 600 }}>พร้อมค้นและตอบจากข้อมูลจริงในขอบเขตนี้</p>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
              ค้นหาจากโน้ตจริง บันทึกประชุมที่อนุญาต และคลังความรู้ (ข้ามประชุมที่ตั้งเป็น{' '}
              <code>local_only</code> อัตโนมัติเมื่อใช้ Cloud CLI)
            </p>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="assistant-turn">
              <div className="assistant-user-msg">{turn.query}</div>
              {turn.error ? (
                <div className="assistant-warn-box">{turn.error}</div>
              ) : !turn.response ? (
                <div className="assistant-reply-box">
                  <Loader2 size={14} className="spin-icon" /> กำลังค้นบริบท…
                </div>
              ) : (
                <div className="assistant-reply-box">
                  {turn.response.filteredLocalOnlyMeetings > 0 && (
                    <div className="assistant-warn-box">
                      <ShieldAlert size={14} /> ข้ามบันทึกประชุมส่วนตัว (<code>local_only</code>) จำนวน{' '}
                      {turn.response.filteredLocalOnlyMeetings} รายการ เพื่อไม่ส่งความลับออกนอกเครื่อง
                    </div>
                  )}

                  {turn.response.redacted && (
                    <div className="assistant-redact-pill">
                      ปิดบังชื่อ/อีเมลอัตโนมัติ (PII Redacted) ก่อนส่ง Cloud CLI
                    </div>
                  )}

                  <div className="assistant-sources-block">
                    {turn.response.sources.noteHits.length === 0 &&
                    turn.response.sources.meetings.length === 0 &&
                    turn.response.sources.knowledge.length === 0 &&
                    turn.response.sources.notes.length === 0 ? (
                      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                        ไม่พบข้อมูลที่ตรงกับคำถามในขอบเขตนี้
                      </p>
                    ) : (
                      <>
                        {turn.response.sources.noteHits.length > 0 && (
                          <div>
                            <strong>โน้ตที่ตรงคำค้น ({turn.response.sources.noteHits.length})</strong>
                            <ul className="insights-mini-list">
                              {turn.response.sources.noteHits.map((hit) => (
                                <li key={hit.path}>
                                  <button
                                    type="button"
                                    className="insights-link-btn"
                                    onClick={() => onOpenNoteByPath(hit.path)}
                                  >
                                    {hit.title}
                                  </button>
                                  {hit.snippet && (
                                    <div className="muted" style={{ fontSize: 12 }}>
                                      {hit.snippet}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {turn.response.sources.meetings.length > 0 && (
                          <div>
                            <strong>สรุปประชุมที่เข้าถึงได้ ({turn.response.sources.meetings.length})</strong>
                            <ul className="insights-mini-list">
                              {turn.response.sources.meetings.map((m) => (
                                <li key={m.id}>
                                  <strong>{m.title}</strong>{' '}
                                  <span className="muted" style={{ fontSize: 11.5 }}>
                                    ({m.visibility})
                                  </span>
                                  {m.summary && (
                                    <div className="muted" style={{ fontSize: 12 }}>
                                      {m.summary}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {turn.response.sources.knowledge.length > 0 && (
                          <div>
                            <strong>คลังความรู้ ({turn.response.sources.knowledge.length})</strong>
                            <ul className="insights-mini-list">
                              {turn.response.sources.knowledge.map((k) => (
                                <li key={k.id}>
                                  <strong>{k.title}</strong>
                                  {k.summary && (
                                    <div className="muted" style={{ fontSize: 12 }}>
                                      {k.summary}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="assistant-model-footer">
                    ตอบโดย: {turn.response.provider}
                    {turn.response.model ? ` (${turn.response.model})` : ''} · ขอบเขต:{' '}
                    {turn.response.scope}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <form className="assistant-input-bar" onSubmit={(e) => void handleSubmit(e)}>
        <input
          className="settings-input"
          style={{ flex: 1 }}
          placeholder="ถามผู้ช่วย AI เกี่ยวกับโน้ต ประชุม หรือความรู้…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="v5-btn primary" disabled={loading || !input.trim()}>
          <Send size={14} />
        </button>
      </form>
    </aside>
  );
}
