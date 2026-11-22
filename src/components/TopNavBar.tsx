import { Archive, FilePlus2, Sparkles, StickyNote } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import type { AppSection } from '../types';

interface TopNavBarProps {
  section: AppSection;
  onSelectSection: (section: AppSection) => void;
  onNewNote: () => void;
  onNewScratch: () => void;
  onOpenClosedHistory: () => void;
  onOpenAssistant: () => void;
}

const SECTION_TABS: Array<{ id: Exclude<AppSection, 'settings'>; label: string }> = [
  { id: 'insights', label: 'Insights' },
  { id: 'notes', label: 'Notes' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'knowledge', label: 'Knowledge' }
];

export function TopNavBar({
  section,
  onSelectSection,
  onNewNote,
  onNewScratch,
  onOpenClosedHistory,
  onOpenAssistant
}: TopNavBarProps) {
  const { activeScope, setActiveScope, projects } = useNotesStore();

  let scopeTitle = 'ภาพรวม';
  if (section === 'settings') {
    scopeTitle = 'ตั้งค่า';
  } else if (activeScope === 'general') {
    scopeTitle = 'ทั่วไป';
  } else if (activeScope.startsWith('project:')) {
    const slug = activeScope.slice('project:'.length);
    scopeTitle = projects.find((p) => p.slug === slug)?.name ?? slug;
  }

  const isOverviewScope = activeScope === 'all' || activeScope === 'general';

  return (
    <header className="v5-topbar">
      <div className="v5-scope-head">
        <h1 className="v5-scope-title">{scopeTitle}</h1>
        {section !== 'settings' && isOverviewScope && (
          <div className="v5-pill-switch" role="group" aria-label="สลับโหมดภาพรวม">
            <button
              type="button"
              className={activeScope === 'all' ? 'active' : ''}
              onClick={() => setActiveScope('all')}
            >
              ทุกโปรเจค
            </button>
            <button
              type="button"
              className={activeScope === 'general' ? 'active' : ''}
              onClick={() => setActiveScope('general')}
            >
              ทั่วไป
            </button>
          </div>
        )}
      </div>

      {section !== 'settings' && (
        <nav className="v5-tabs-nav" aria-label="หมวดงาน">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={section === tab.id ? 'active' : ''}
              onClick={() => onSelectSection(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div className="v5-topbar-actions">
        {section === 'notes' && (
          <>
            <button type="button" className="v5-btn primary" onClick={onNewNote}>
              <FilePlus2 size={14} /> + โน้ตใหม่
            </button>
            <button type="button" className="v5-btn scratch" onClick={onNewScratch}>
              <StickyNote size={14} /> + ร่างใหม่
            </button>
          </>
        )}
        <button
          type="button"
          className="v5-btn"
          title="ผู้ช่วย AI ส่วนตัว"
          onClick={onOpenAssistant}
        >
          <Sparkles size={14} /> ผู้ช่วย AI
        </button>
        <button
          type="button"
          className="v5-btn"
          title="ประวัติที่ปิดแล้ว"
          onClick={onOpenClosedHistory}
        >
          <Archive size={14} /> ประวัติที่ปิดแล้ว
        </button>
      </div>
    </header>
  );
}
