import { useEffect, useState } from 'react';
import {
  Database,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users
} from 'lucide-react';
import {
  apiCreateVoiceprint,
  apiDeleteContact,
  apiDeleteVoiceprint,
  apiListContacts,
  apiListVoiceprints,
  apiRebuildIndex,
  apiRunBackup,
  apiSmartSync,
  apiUpsertContact,
  type AiRoleConfig,
  type ContactItem,
  type VoiceprintItem
} from '../lib/api';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AccentId, EditorWidthPreset, FontId, ThemeMode } from '../types';

type SettingsTab = 'general' | 'ai' | 'sync' | 'meetings' | 'storage' | 'accounts';

interface SettingsViewProps {
  onNotice: (message: string) => void;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'ทั่วไปและหน้าตา' },
  { id: 'ai', label: 'ผู้ช่วย AI' },
  { id: 'sync', label: 'อัปเดตอัตโนมัติ' },
  { id: 'meetings', label: 'ประชุมและเสียง' },
  { id: 'storage', label: 'ที่เก็บและโน้ต' },
  { id: 'accounts', label: 'เชื่อมต่อบัญชี' }
];

const ACCENTS: Array<{ id: AccentId; label: string; color: string }> = [
  { id: 'indigo', label: 'คราม (Indigo)', color: '#3b4fd8' },
  { id: 'teal', label: 'เขียวน้ำทะเล', color: '#0f766e' },
  { id: 'forest', label: 'เขียวป่า', color: '#2f7a47' },
  { id: 'amber', label: 'อำพัน', color: '#b4690e' },
  { id: 'rose', label: 'กุหลาบ', color: '#be3e5b' },
  { id: 'plum', label: 'พลัม', color: '#7c3aed' },
  { id: 'slate', label: 'เทาหินชนวน', color: '#475569' },
  { id: 'ocean', label: 'ฟ้าน้ำลึก', color: '#0369a1' }
];

const FONTS: Array<{ id: FontId; label: string; family: string }> = [
  { id: 'ibm-plex', label: 'IBM Plex Sans Thai', family: '"IBM Plex Sans Thai", sans-serif' },
  { id: 'sarabun', label: 'Sarabun', family: '"Sarabun", sans-serif' },
  { id: 'noto-sans', label: 'Noto Sans Thai', family: '"Noto Sans Thai", sans-serif' },
  { id: 'noto-serif', label: 'Noto Serif Thai', family: '"Noto Serif Thai", serif' }
];

const AI_ROLES: Array<{ key: 'insights' | 'meetings' | 'knowledge' | 'assistant'; label: string }> = [
  { key: 'insights', label: 'สรุป Insights' },
  { key: 'meetings', label: 'สรุปประชุม' },
  { key: 'knowledge', label: 'ย่อยความรู้' },
  { key: 'assistant', label: 'แชทผู้ช่วย AI ส่วนตัว' }
];

const PROVIDERS = [
  { id: 'lms', label: 'LM Studio (Local ฟรี)' },
  { id: 'claude', label: 'Claude CLI' },
  { id: 'grok', label: 'Grok CLI' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' }
];

export function SettingsView({ onNotice }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const {
    theme,
    accentColor,
    fontFamily,
    fontSize,
    editorWidth,
    backendSettings,
    cliCache,
    setTheme,
    setAccentColor,
    setFontFamily,
    setFontSize,
    setEditorWidth,
    resetAppearance,
    patchBackendSettings,
    refreshCliCache
  } = useSettingsStore();
  const dataRoot = useNotesStore((s) => s.dataRoot);

  const [voiceprints, setVoiceprints] = useState<VoiceprintItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [newVpName, setNewVpName] = useState('');
  const [newVpNick, setNewVpNick] = useState('');
  const [newVpEmail, setNewVpEmail] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactNick, setNewContactNick] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [backupDest, setBackupDest] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (backendSettings?.backup?.destination) {
      setBackupDest(backendSettings.backup.destination);
    }
  }, [backendSettings?.backup?.destination]);

  useEffect(() => {
    if (activeTab === 'meetings') {
      void apiListVoiceprints().then((r) => setVoiceprints(r.voiceprints)).catch(() => {});
    } else if (activeTab === 'accounts') {
      void apiListContacts().then((r) => setContacts(r.contacts)).catch(() => {});
    }
  }, [activeTab]);

  const updateAiRole = (
    role: 'insights' | 'meetings' | 'knowledge' | 'assistant',
    patch: Partial<AiRoleConfig>
  ) => {
    const current = backendSettings?.aiDefaults?.[role] ?? {
      provider: 'lms',
      model: '',
      effort: 'medium'
    };
    void patchBackendSettings({
      aiDefaults: { [role]: { ...current, ...patch } }
    }).then(() => onNotice('บันทึกการตั้งค่า AI แล้ว'));
  };

  return (
    <section className="settings-view" aria-label="ตั้งค่า">
      <div className="settings-container">
        <nav className="settings-tabs-bar" role="tablist" aria-label="หมวดการตั้งค่า">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`settings-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'general' && (
          <>
            <div className="settings-card">
              <h2>ภาพรวมการตั้งค่า</h2>
              <div className="settings-overview-grid">
                <button
                  type="button"
                  className="settings-overview-tile"
                  onClick={() => setActiveTab('ai')}
                >
                  <Sparkles size={18} />
                  <strong>ผู้ช่วย AI</strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    ค่าเริ่มต้น: {backendSettings?.aiDefaults?.insights?.provider || 'lms'} (Local)
                  </span>
                </button>
                <button
                  type="button"
                  className="settings-overview-tile"
                  onClick={() => setActiveTab('sync')}
                >
                  <RefreshCw size={18} />
                  <strong>อัปเดตอัตโนมัติ</strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Change-Only Smart Sync (0 tokens เมื่อไม่เปลี่ยน)
                  </span>
                </button>
                <button
                  type="button"
                  className="settings-overview-tile"
                  onClick={() => setActiveTab('meetings')}
                >
                  <Shield size={18} />
                  <strong>ประชุมและเสียง</strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    ความเป็นส่วนตัว {backendSettings?.privacy?.defaultMeetingVisibility || 'local_only'}
                  </span>
                </button>
                <button
                  type="button"
                  className="settings-overview-tile"
                  onClick={() => setActiveTab('storage')}
                >
                  <HardDrive size={18} />
                  <strong>ที่เก็บและโน้ต</strong>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {dataRoot || 'PlainMarkData'} · สำรองข้อมูล &amp; ดัชนี
                  </span>
                </button>
              </div>
            </div>

            <div className="settings-card">
              <h3>โหมดหน้าจอ</h3>
              <div className="settings-capsule-group">
                {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={theme === mode ? 'active' : ''}
                    onClick={() => setTheme(mode)}
                  >
                    {mode === 'system' ? 'ตามเครื่อง' : mode === 'light' ? 'สว่าง' : 'มืด'}
                  </button>
                ))}
              </div>

              <h3>ความกว้างพื้นที่เขียนโน้ตเริ่มต้น</h3>
              <div className="settings-capsule-group">
                {(['narrow', 'wide', 'full'] as EditorWidthPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={editorWidth === preset ? 'active' : ''}
                    onClick={() => setEditorWidth(preset)}
                  >
                    {preset === 'narrow'
                      ? 'พอดีอ่าน (760px)'
                      : preset === 'wide'
                        ? 'กว้าง (1040px)'
                        : 'เต็มจอ (100%)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-row">
                <h2>สไตล์ของคุณ</h2>
                <button
                  type="button"
                  className="v5-btn"
                  onClick={() => {
                    resetAppearance();
                    onNotice('รีเซ็ตสไตล์เริ่มต้นแล้ว');
                  }}
                >
                  <RotateCcw size={13} /> รีเซ็ตเริ่มต้น
                </button>
              </div>

              <h3>สีหลัก (8 สี)</h3>
              <div className="accent-grid">
                {ACCENTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`accent-swatch-btn ${accentColor === item.id ? 'active' : ''}`}
                    onClick={() => setAccentColor(item.id)}
                  >
                    <span className="accent-dot" style={{ background: item.color }} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <h3>แบบอักษร (4 ฟอนต์)</h3>
              <div className="font-grid">
                {FONTS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`font-card-btn ${fontFamily === f.id ? 'active' : ''}`}
                    style={{ fontFamily: f.family }}
                    onClick={() => setFontFamily(f.id)}
                  >
                    <span className="font-aa">Aa กข</span>
                    <span style={{ fontSize: 12.5 }}>{f.label}</span>
                  </button>
                ))}
              </div>

              <div className="settings-row">
                <h3>ขนาดตัวอักษร ({fontSize}px)</h3>
                <input
                  type="range"
                  min={13}
                  max={17}
                  step={1}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
              </div>

              <div className="live-preview-box">
                <strong style={{ color: 'var(--accent-ink)' }}>ตัวอย่างหน้าตาสด (Live Preview)</strong>
                <span>
                  ข้อความตัวอย่างใน PlainMark — ปรับสี ฟอนต์ และขนาดตัวอักษรได้ทันทีโดยบันทึกไว้ใน{' '}
                  <code>settings.json</code>
                </span>
              </div>
            </div>
          </>
        )}

        {activeTab === 'ai' && (
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <h2>ผู้ช่วย AI และโมเดลแต่ละหน้าที่</h2>
                <span className="muted" style={{ fontSize: 13 }}>
                  ค่าเริ่มต้นเป็น Local (LM Studio ฟรีในเครื่อง) — เลือกสลับค่าย CLI แยกตามหน้าที่ได้อิสระ
                </span>
              </div>
              <button
                type="button"
                className="v5-btn primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void refreshCliCache()
                    .then(() => onNotice('อัปเดตรายการ CLI แล้ว'))
                    .finally(() => setBusy(false));
                }}
              >
                <RefreshCw size={14} /> อัปเดตรายการโมเดลทุก CLI
              </button>
            </div>

            {cliCache && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.values(cliCache.clis).map((cli) => (
                  <span
                    key={cli.name}
                    className="rail-count"
                    style={{
                      background: cli.available ? 'var(--ok-soft)' : 'var(--surface-3)',
                      color: cli.available ? 'var(--ok)' : 'var(--ink-3)'
                    }}
                  >
                    {cli.label}: {cli.available ? 'พร้อมใช้' : 'ไม่พบใน PATH'}
                  </span>
                ))}
              </div>
            )}

            {AI_ROLES.map((role) => {
              const cfg = backendSettings?.aiDefaults?.[role.key] ?? {
                provider: 'lms',
                model: '',
                effort: 'medium'
              };
              return (
                <div
                  key={role.key}
                  className="settings-row"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--r)',
                    border: '1px solid var(--rule)',
                    background: 'var(--surface-2)'
                  }}
                >
                  <strong style={{ minWidth: 160, fontSize: 13.5 }}>{role.label}</strong>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select
                      className="settings-select"
                      value={cfg.provider}
                      onChange={(e) => updateAiRole(role.key, { provider: e.target.value })}
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="settings-input"
                      placeholder="ชื่อโมเดล (เว้นว่างใช้ค่าเริ่มต้น)"
                      value={cfg.model}
                      onChange={(e) => updateAiRole(role.key, { model: e.target.value })}
                    />
                    <select
                      className="settings-select"
                      value={cfg.effort}
                      onChange={(e) =>
                        updateAiRole(role.key, {
                          effort: e.target.value as 'low' | 'medium' | 'high'
                        })
                      }
                    >
                      <option value="low">เร็ว (Low)</option>
                      <option value="medium">สมดุล (Medium)</option>
                      <option value="high">ลึก (High)</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="settings-card">
            <h2>อัปเดตอัตโนมัติ (Change-Only Smart Sync)</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              ระบบตรวจรหัสข้อมูล (<code>source_hash</code>) ของโน้ต ประชุม และความรู้ก่อนสรุปเสมอ
              หากขอบเขตไหนไม่มีการเปลี่ยนแปลงจะข้ามทันทีโดยใช้ 0 tokens (ไม่รวมกระดาษร่างใน <code>scratch/</code>)
            </p>
            <div className="settings-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={Boolean(backendSettings?.sync?.autoSyncEnabled ?? true)}
                  onChange={(e) => {
                    void patchBackendSettings({
                      sync: { autoSyncEnabled: e.target.checked }
                    }).then(() => onNotice('บันทึกการตั้งค่า Smart Sync แล้ว'));
                  }}
                />
                เปิดตรวจ Smart Sync อัตโนมัติเมื่อเปิดหน้า Insights
              </label>
              <button
                type="button"
                className="v5-btn primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void apiSmartSync({ scope: 'all' })
                    .then((res) => {
                      const synced = res.results.filter((r) => r.status === 'synced').length;
                      const skipped = res.results.filter((r) => r.status === 'skipped').length;
                      onNotice(`Smart Sync: อัปเดต ${synced}, ข้าม ${skipped} ขอบเขต (0 tokens)`);
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <RefreshCw size={14} /> รัน Smart Sync ตอนนี้
              </button>
            </div>
          </div>
        )}

        {activeTab === 'meetings' && (
          <>
            <div className="settings-card">
              <h2>ประชุมและเสียง (Local-First &amp; PDPA)</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                สแตกออฟไลน์ในเครื่อง: <code>OpenVINO Whisper</code> +{' '}
                <code>OpenThai 2.0 ASR ONNX FP32</code> + <code>OpenThai 2.1 OCR-Text</code>
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={(backendSettings?.privacy?.defaultMeetingVisibility ?? 'local_only') === 'local_only'}
                  onChange={(e) => {
                    void patchBackendSettings({
                      privacy: {
                        defaultMeetingVisibility: e.target.checked ? 'local_only' : 'shareable'
                      }
                    }).then(() => onNotice('บันทึกค่าเริ่มต้นความเป็นส่วนตัวแล้ว'));
                  }}
                />
                ตั้งค่าเริ่มต้นประชุมใหม่เป็นเฉพาะในเครื่อง (<code>local_only</code>)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={Boolean(backendSettings?.privacy?.redactPiiOnCloud ?? true)}
                  onChange={(e) => {
                    void patchBackendSettings({
                      privacy: { redactPiiOnCloud: e.target.checked }
                    }).then(() => onNotice('บันทึกการปิดบังชื่อ/อีเมลแล้ว'));
                  }}
                />
                ปิดบังชื่อและอีเมลอัตโนมัติ (Redact PII) เมื่อส่งออก Cloud CLI
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={Boolean(backendSettings?.privacy?.anonymousMode ?? false)}
                  onChange={(e) => {
                    void patchBackendSettings({
                      privacy: { anonymousMode: e.target.checked }
                    }).then(() => onNotice('บันทึกโหมด Anonymous แล้ว'));
                  }}
                />
                โหมดไม่ระบุตัวตน (Anonymous Mode — ใช้รหัส Speaker แทนชื่อจริง)
              </label>
            </div>

            <div className="settings-card">
              <h3>คลังจำเสียงผู้พูด (Voiceprint Directory — เก็บเฉพาะ Embedding)</h3>
              <form
                className="settings-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newVpName.trim()) return;
                  void apiCreateVoiceprint({
                    name: newVpName.trim(),
                    nickname: newVpNick.trim(),
                    email: newVpEmail.trim(),
                    embedding: []
                  }).then((vp) => {
                    setVoiceprints((prev) => [...prev, vp]);
                    setNewVpName('');
                    setNewVpNick('');
                    setNewVpEmail('');
                    onNotice(`เพิ่มผู้พูด ${vp.name} แล้ว`);
                  });
                }}
              >
                <input
                  className="settings-input"
                  placeholder="ชื่อผู้พูด…"
                  value={newVpName}
                  onChange={(e) => setNewVpName(e.target.value)}
                />
                <input
                  className="settings-input"
                  placeholder="ชื่อเล่น…"
                  value={newVpNick}
                  onChange={(e) => setNewVpNick(e.target.value)}
                />
                <input
                  className="settings-input"
                  placeholder="อีเมล…"
                  value={newVpEmail}
                  onChange={(e) => setNewVpEmail(e.target.value)}
                />
                <button type="submit" className="v5-btn primary">
                  <UserPlus size={14} /> เพิ่มผู้พูด
                </button>
              </form>

              {voiceprints.length === 0 ? (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  ยังไม่มีโปรไฟล์เสียงใน <code>shared/voiceprints/</code>
                </p>
              ) : (
                voiceprints.map((vp) => (
                  <div
                    key={vp.id}
                    className="settings-row"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--r)',
                      border: '1px solid var(--rule)',
                      background: 'var(--surface-2)'
                    }}
                  >
                    <div>
                      <strong>{vp.name}</strong>
                      {vp.nickname ? ` (${vp.nickname})` : ''}
                      {vp.email ? <span className="muted"> · {vp.email}</span> : null}
                    </div>
                    <button
                      type="button"
                      className="v5-btn danger"
                      onClick={() => {
                        void apiDeleteVoiceprint(vp.id).then(() => {
                          setVoiceprints((prev) => prev.filter((item) => item.id !== vp.id));
                          onNotice(`ลบเสียง ${vp.name} (Forget Speaker) แล้ว`);
                        });
                      }}
                    >
                      <Trash2 size={13} /> Forget Speaker
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {activeTab === 'storage' && (
          <div className="settings-card">
            <h2>ที่เก็บข้อมูล, สำรองข้อมูล และดัชนีค้นหา</h2>
            <div className="settings-row">
              <span style={{ fontSize: 13.5 }}>โฟลเดอร์หลัก (Source of Truth):</span>
              <code>{dataRoot || 'C:\\Users\\KeyPe\\PlainMarkData'}</code>
            </div>

            <div className="v5-field">
              <label htmlFor="backup-dest-input">โฟลเดอร์ปลายทาง Nightly Backup (เก็บ 7 วัน / 4 สัปดาห์, ข้าม SQLite และไฟล์วิดีโอใหญ่)</label>
              <div className="settings-row">
                <input
                  id="backup-dest-input"
                  className="settings-input"
                  style={{ flex: 1 }}
                  placeholder="เช่น D:\\Backups\\PlainMark"
                  value={backupDest}
                  onChange={(e) => setBackupDest(e.target.value)}
                />
                <button
                  type="button"
                  className="v5-btn"
                  onClick={() => {
                    void patchBackendSettings({
                      backup: { destination: backupDest.trim() }
                    }).then(() => onNotice('บันทึกปลายทางสำรองข้อมูลแล้ว'));
                  }}
                >
                  บันทึกปลายทาง
                </button>
                <button
                  type="button"
                  className="v5-btn primary"
                  disabled={busy || !backupDest.trim()}
                  onClick={() => {
                    setBusy(true);
                    void apiRunBackup({ destination: backupDest.trim() })
                      .then((res) =>
                        onNotice(`สำรองแล้ว ${res.backedUpFiles} ไฟล์ (ข้าม ${res.skippedFiles} ไฟล์)`)
                      )
                      .catch((err: Error) => onNotice(err.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  สำรองข้อมูลตอนนี้
                </button>
              </div>
            </div>

            <div className="settings-row" style={{ paddingTop: 8, borderTop: '1px solid var(--rule)' }}>
              <div>
                <strong>สร้างดัชนีค้นหาใหม่จากดิสก์ (<code>plainmark.sqlite</code>)</strong>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  ลบและสร้าง SQLite FTS5 + WordSeg ใหม่ทั้งหมดจากไฟล์ .md บนดิสก์ 100%
                </div>
              </div>
              <button
                type="button"
                className="v5-btn"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void apiRebuildIndex()
                    .then((res) => onNotice(`สร้างดัชนีใหม่แล้ว (${res.indexedNotes} โน้ต)`))
                    .finally(() => setBusy(false));
                }}
              >
                <Database size={14} /> Rebuild Search Index
              </button>
            </div>
          </div>
        )}

        {activeTab === 'accounts' && (
          <>
            <div className="settings-card">
              <h2>
                <Users size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                รายชื่อผู้ติดต่อในเครื่อง (<code>shared/contacts.json</code>)
              </h2>
              <form
                className="settings-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newContactName.trim() && !newContactEmail.trim()) return;
                  void apiUpsertContact({
                    name: newContactName.trim(),
                    nickname: newContactNick.trim(),
                    email: newContactEmail.trim()
                  }).then((c) => {
                    setContacts((prev) => [...prev, c]);
                    setNewContactName('');
                    setNewContactNick('');
                    setNewContactEmail('');
                    onNotice('เพิ่มรายชื่อผู้ติดต่อแล้ว');
                  });
                }}
              >
                <input
                  className="settings-input"
                  placeholder="ชื่อ…"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
                <input
                  className="settings-input"
                  placeholder="ชื่อเล่น…"
                  value={newContactNick}
                  onChange={(e) => setNewContactNick(e.target.value)}
                />
                <input
                  className="settings-input"
                  placeholder="อีเมล…"
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                />
                <button type="submit" className="v5-btn primary">
                  <UserPlus size={14} /> เพิ่มรายชื่อ
                </button>
              </form>

              {contacts.length === 0 ? (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  ยังไม่มีรายชื่อผู้ติดต่อในเครื่อง
                </p>
              ) : (
                contacts.map((c) => (
                  <div
                    key={c.id}
                    className="settings-row"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--r)',
                      border: '1px solid var(--rule)',
                      background: 'var(--surface-2)'
                    }}
                  >
                    <div>
                      <strong>{c.name || c.email}</strong>
                      {c.nickname ? ` (${c.nickname})` : ''}
                      {c.email && c.name ? <span className="muted"> · {c.email}</span> : null}
                    </div>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      title="ลบรายชื่อ"
                      onClick={() => {
                        void apiDeleteContact(c.id).then(() => {
                          setContacts((prev) => prev.filter((item) => item.id !== c.id));
                          onNotice('ลบรายชื่อแล้ว');
                        });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="settings-card">
              <h3>Google Calendar &amp; Contacts (ตัวเลือกเสริม)</h3>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                ไม่บังคับต้องเชื่อมต่อเพื่อใช้งาน PlainMark — รายชื่อผู้ติดต่อในเครื่องด้านบนทำงานออฟไลน์ได้ทันที
                (หมายเหตุ: หากเปิดใช้ Google OAuth ในโหมด Testing, Refresh Token จะหมดอายุทุก 7 วัน)
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
