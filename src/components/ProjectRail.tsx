import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderKanban,
  FolderPlus,
  Layers,
  Moon,
  Search,
  Settings,
  Sun
} from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AppSection, ThemeMode } from '../types';

interface ProjectRailProps {
  section: AppSection;
  onSelectSection: (section: AppSection) => void;
  onOpenSearch: () => void;
  onNotice: (message: string) => void;
}

function themeLabel(theme: ThemeMode): string {
  if (theme === 'dark') return 'มืด';
  if (theme === 'light') return 'สว่าง';
  return 'ตามเครื่อง';
}

export function ProjectRail({ section, onSelectSection, onOpenSearch, onNotice }: ProjectRailProps) {
  const { projects, generalNotes, activeScope, setActiveScope, addProject, toggleProjectHidden } =
    useNotesStore();
  const { theme, setTheme } = useSettingsStore();
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const visibleProjects = projects.filter((p) => !p.hidden);
  const hiddenProjects = projects.filter((p) => p.hidden);
  const totalNotes =
    generalNotes.length + visibleProjects.reduce((sum, p) => sum + p.notes.length, 0);

  const isOverview = section !== 'settings' && (activeScope === 'all' || activeScope === 'general');

  const handleSelectOverview = () => {
    if (activeScope !== 'all' && activeScope !== 'general') {
      setActiveScope('all');
    }
    if (section === 'settings') onSelectSection('notes');
  };

  const handleSelectProject = (slug: string) => {
    setActiveScope(`project:${slug}`);
    if (section === 'settings') onSelectSection('notes');
  };

  const handleAddProject = () => {
    const name = window.prompt('ตั้งชื่อโปรเจคใหม่ (เช่น Self_development, งานประจำ):');
    if (!name?.trim()) return;
    const repoPath = window.prompt('ผูกกับโฟลเดอร์โค้ด/งานเดิม (ไม่บังคับ — เว้นว่างได้):', '');
    void addProject(name.trim(), repoPath?.trim() || null).then((created) => {
      if (created) {
        onNotice(`สร้าง "${created.name}" แล้ว`);
        if (section === 'settings') onSelectSection('notes');
      }
    });
  };

  const cycleTheme = () => {
    const next: ThemeMode = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
  };

  return (
    <aside className="project-rail" aria-label="ขอบเขตและโปรเจค">
      <div className="rail-brand">
        <span className="rail-brand-mark">P</span>
        <span className="rail-brand-title">PlainMark</span>
      </div>

      <button
        type="button"
        className={`rail-nav-btn ${isOverview ? 'active' : ''}`}
        onClick={handleSelectOverview}
      >
        <span className="rail-nav-left">
          <Layers size={16} />
          <span className="rail-nav-label">ภาพรวม</span>
        </span>
        <span className="rail-count">{totalNotes}</span>
      </button>

      <div className="rail-section-head">
        <span>รายการโปรเจค</span>
        <span className="tnum">{visibleProjects.length}</span>
      </div>

      <div className="rail-scroll">
        {visibleProjects.map((project) => {
          const active = section !== 'settings' && activeScope === `project:${project.slug}`;
          return (
            <div key={project.slug} className="rail-project-row">
              <button
                type="button"
                className={`rail-nav-btn ${active ? 'active' : ''}`}
                onClick={() => handleSelectProject(project.slug)}
              >
                <span className="rail-nav-left">
                  <FolderKanban size={15} />
                  <span className="rail-nav-label">{project.name}</span>
                </span>
                <span className="rail-count">{project.notes.length}</span>
              </button>
              <button
                type="button"
                className="rail-hide-btn"
                title={`ซ่อน ${project.name}`}
                aria-label={`ซ่อน ${project.name}`}
                onClick={() => {
                  void toggleProjectHidden(project.slug, true);
                  onNotice(`ซ่อน ${project.name} แล้ว`);
                }}
              >
                <EyeOff size={13} />
              </button>
            </div>
          );
        })}

        {hiddenProjects.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="rail-hidden-toggle"
              onClick={() => setHiddenOpen((v) => !v)}
            >
              <span>โปรเจคที่ซ่อนไว้ ({hiddenProjects.length})</span>
              {hiddenOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {hiddenOpen &&
              hiddenProjects.map((project) => (
                <div key={project.slug} className="rail-project-row">
                  <button
                    type="button"
                    className="rail-nav-btn"
                    onClick={() => {
                      void toggleProjectHidden(project.slug, false);
                      handleSelectProject(project.slug);
                      onNotice(`เปิดแสดง ${project.name} แล้ว`);
                    }}
                  >
                    <span className="rail-nav-left">
                      <Eye size={14} />
                      <span className="rail-nav-label">{project.name}</span>
                    </span>
                    <span className="rail-count">{project.notes.length}</span>
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      <button type="button" className="rail-add-btn" onClick={handleAddProject}>
        <FolderPlus size={15} />
        <span>+ สร้างโปรเจค</span>
      </button>

      <div className="rail-footer">
        <button type="button" className="rail-nav-btn" onClick={onOpenSearch}>
          <span className="rail-nav-left">
            <Search size={15} />
            <span className="rail-nav-label">ค้นหาด่วน</span>
          </span>
          <span className="kbd">Ctrl+K</span>
        </button>

        <button
          type="button"
          className={`rail-nav-btn ${section === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectSection(section === 'settings' ? 'notes' : 'settings')}
        >
          <span className="rail-nav-left">
            <Settings size={15} />
            <span className="rail-nav-label">ตั้งค่า</span>
          </span>
        </button>

        <button type="button" className="rail-nav-btn" onClick={cycleTheme}>
          <span className="rail-nav-left">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            <span className="rail-nav-label">โหมด: {themeLabel(theme)}</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
