import { useMemo, useState } from 'react';
import { ArrowRightCircle, Copy, FileText, Search, StickyNote, Trash2 } from 'lucide-react';
import type { NoteMeta, ScratchMeta } from '../lib/api';
import { apiReadScratch } from '../lib/api';
import { useDocStore } from '../store/docStore';
import { useNotesStore } from '../store/notesStore';
import type { CloseReasonTarget } from './CloseReasonModal';

interface NotesListCardProps {
  onOpenNote: (note: NoteMeta) => void;
  onOpenScratch: (scratch: ScratchMeta) => void;
  onRequestClose: (target: CloseReasonTarget) => void;
  onNotice: (message: string) => void;
}

export function NotesListCard({
  onOpenNote,
  onOpenScratch,
  onRequestClose,
  onNotice
}: NotesListCardProps) {
  const { projects, generalNotes, scratches, activeScope, promoteScratch } = useNotesStore();
  const activeNotePath = useDocStore((s) => s.notePath);
  const activeScratchId = useDocStore((s) => s.scratchId);
  const [listMode, setListMode] = useState<'notes' | 'scratches'>('notes');
  const [searchQuery, setSearchQuery] = useState('');

  const scopedNotes = useMemo(() => {
    const visibleProjects = projects.filter((p) => !p.hidden);
    let list: NoteMeta[] = [];
    if (activeScope === 'general') {
      list = generalNotes;
    } else if (activeScope === 'all') {
      list = [...generalNotes, ...visibleProjects.flatMap((p) => p.notes)];
    } else if (activeScope.startsWith('project:')) {
      const slug = activeScope.slice('project:'.length);
      list = projects.find((p) => p.slug === slug)?.notes ?? [];
    }
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (n) =>
            n.name.toLowerCase().includes(q) ||
            (n.projectSlug || '').toLowerCase().includes(q)
        )
      : list;
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects, generalNotes, activeScope, searchQuery]);

  const filteredScratches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scratches;
    return scratches.filter((s) => s.title.toLowerCase().includes(q));
  }, [scratches, searchQuery]);

  const targetPromoteScope = activeScope === 'all' ? 'general' : activeScope;

  return (
    <aside className="notes-list-card" aria-label="รายการโน้ตและกระดาษร่าง">
      <div className="notes-list-head">
        <div className="v5-pill-switch" role="tablist" aria-label="ประเภทโน้ต">
          <button
            type="button"
            role="tab"
            aria-selected={listMode === 'notes'}
            className={listMode === 'notes' ? 'active' : ''}
            onClick={() => setListMode('notes')}
          >
            โน้ตจริง ({scopedNotes.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listMode === 'scratches'}
            className={listMode === 'scratches' ? 'active' : ''}
            onClick={() => setListMode('scratches')}
          >
            ร่าง ({scratches.length})
          </button>
        </div>
      </div>

      <div className="notes-search-box">
        <Search size={14} className="muted" />
        <input
          id="noteListSearch"
          type="search"
          placeholder={listMode === 'notes' ? 'กรองชื่อโน้ต…' : 'กรองชื่อร่าง…'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="notes-list-items">
        {listMode === 'notes' ? (
          scopedNotes.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, padding: '12px 6px', margin: 0 }}>
              {searchQuery ? 'ไม่พบโน้ตที่ตรงกัน' : 'ยังไม่มีโน้ตในขอบเขตนี้'}
            </p>
          ) : (
            scopedNotes.map((note) => {
              const active = activeNotePath === note.path;
              return (
                <div
                  key={note.path}
                  className={`note-card-item ${active ? 'active' : ''}`}
                  onClick={() => onOpenNote(note)}
                >
                  <div className="note-card-top">
                    <span className="note-card-title">
                      <FileText size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} />
                      {note.name}
                    </span>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      title="ปิด / ลบโน้ต"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestClose({
                          itemType: 'note',
                          scope: note.scope || (note.projectSlug === '_general' ? 'general' : `project:${note.projectSlug}`),
                          title: note.name,
                          idOrPath: note.path,
                          snapshot: { title: note.name, path: note.path }
                        });
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="note-card-meta">
                    <span>{note.projectSlug === '_general' ? 'ทั่วไป' : note.projectSlug}</span>
                  </div>
                </div>
              );
            })
          )
        ) : filteredScratches.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, padding: '12px 6px', margin: 0 }}>
            ยังไม่มีกระดาษร่าง — กด &quot;+ ร่างใหม่&quot; ด้านบนได้เลย
          </p>
        ) : (
          filteredScratches.map((sc) => {
            const active = activeScratchId === sc.id;
            return (
              <div
                key={sc.id}
                className={`note-card-item is-scratch ${active ? 'active' : ''}`}
                onClick={() => onOpenScratch(sc)}
              >
                <div className="note-card-top">
                  <span className="note-card-title">
                    <StickyNote size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} />
                    {sc.title}
                  </span>
                  <div className="note-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      title="คัดลอก Prompt ทั้งหมด"
                      onClick={() => {
                        void apiReadScratch(sc.id).then((doc) => {
                          void navigator.clipboard?.writeText(doc.content);
                          onNotice('คัดลอก Prompt แล้ว');
                        });
                      }}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      title="เก็บเป็นโน้ตจริง"
                      onClick={() => {
                        void promoteScratch(sc.id, targetPromoteScope, sc.title).then((note) => {
                          if (note) {
                            onOpenNote(note);
                            onNotice('เก็บเป็นโน้ตจริงแล้ว');
                          }
                        });
                      }}
                    >
                      <ArrowRightCircle size={12} />
                    </button>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      title="ลบทิ้ง"
                      onClick={() =>
                        onRequestClose({
                          itemType: 'scratch',
                          scope: 'general',
                          title: sc.title,
                          idOrPath: sc.id,
                          snapshot: { title: sc.title, id: sc.id }
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="note-card-meta">
                  <span>ชั่วคราว · ไม่เข้า AI Insights</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
