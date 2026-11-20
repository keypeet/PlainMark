import { Download, FileText, FolderOpen, Plus, Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDocStore } from '../store/docStore';

interface TabBarProps {
  onNewTab: () => void;
  onOpenExternal: () => void;
  onSaveAll: () => void;
  onExport: (ext: 'md' | 'txt') => void;
}

export function TabBar({ onNewTab, onOpenExternal, onSaveAll, onExport }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs, closeTabsToRight } = useDocStore();
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  return (
    <header className="tabbar">
      <div className="tabbar-brand" title="PlainMark v2 — Local Project Notes">
        <span className="brand-logo">P</span>
      </div>

      <div className="tabs-strip" role="tablist">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab-item ${active ? 'active' : ''}`}
              title={tab.projectSlug ? `${tab.projectSlug} / ${tab.title}` : tab.title}
              onClick={() => setActiveTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
            >
              <FileText size={13} className="tab-icon" />
              <span className="tab-title">{tab.title}</span>
              {tab.dirty && <span className="tab-dirty" title="ยังไม่ได้บันทึก" />}
              <button
                type="button"
                className="tab-close"
                aria-label={`ปิด ${tab.title}`}
                title="ปิดแท็บ (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="tab-add"
          title="โน้ตใหม่ในโปรเจคที่เลือก (Ctrl+N)"
          aria-label="สร้างแท็บโน้ตใหม่"
          onClick={onNewTab}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="tabbar-actions">
        <button type="button" className="top-mini-btn" title="เปิดไฟล์ .md/.txt จากเครื่อง (Ctrl+O)" onClick={onOpenExternal}>
          <FolderOpen size={14} /> Open
        </button>
        <button type="button" className="top-mini-btn" title="บันทึกทุกแท็บ (Ctrl+Shift+S)" onClick={onSaveAll}>
          <Save size={14} /> Save All
        </button>
        <button type="button" className="top-mini-btn" title="ส่งออกเป็นไฟล์ .md เดี่ยว (ฝังรูป)" onClick={() => onExport('md')}>
          <Download size={14} /> .md
        </button>
        <button type="button" className="top-mini-btn" title="ส่งออกเป็น .txt" onClick={() => onExport('txt')}>
          .txt
        </button>
      </div>

      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              closeTab(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            ปิดแท็บนี้
          </button>
          <button
            type="button"
            onClick={() => {
              closeOtherTabs(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            ปิดแท็บอื่นทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => {
              closeTabsToRight(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            ปิดแท็บทางขวา
          </button>
        </div>
      )}
    </header>
  );
}
