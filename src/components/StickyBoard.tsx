import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  ExternalLink,
  Kanban,
  LayoutGrid,
  Link2,
  Palette,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import {
  apiGetBoard,
  apiSaveBoard,
  type BoardAttachment,
  type BoardCard,
  type BoardData,
  type MeetingRecord,
  type NoteMeta
} from '../lib/api';
import type { CloseReasonTarget } from './CloseReasonModal';

interface StickyBoardProps {
  scope: string;
  notes: NoteMeta[];
  meetings: MeetingRecord[];
  refreshKey?: number;
  onRequestClose: (target: CloseReasonTarget) => void;
  onNavigateLink: (link: BoardAttachment) => void;
  onNotice: (msg: string) => void;
}

const PRESET_COLORS = ['#fef3c7', '#e0f2fe', '#dcfce7', '#fce7f3', '#ede9fe', '#ffedd5'];

const DEFAULT_BOARD: BoardData = {
  mode: 'columns',
  columns: [
    { id: 'todo', title: 'ต้องทำต่อ' },
    { id: 'doing', title: 'กำลังทำ' },
    { id: 'pin', title: 'แปะกันลืม' }
  ],
  cards: [],
  customColors: []
};

export function StickyBoard({
  scope,
  notes,
  meetings,
  refreshKey = 0,
  onRequestClose,
  onNavigateLink,
  onNotice
}: StickyBoardProps) {
  const effectiveScope = scope === 'all' ? 'general' : scope;
  const [board, setBoard] = useState<BoardData>(DEFAULT_BOARD);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [newColTitle, setNewColTitle] = useState('');
  const [addingCol, setAddingCol] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [justAddedIds, setJustAddedIds] = useState<Record<string, boolean>>({});
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    cardId: string;
    x: number;
    y: number;
  } | null>(null);
  const [linkModalCardId, setLinkModalCardId] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<'meeting' | 'note' | 'url'>('meeting');
  const [extUrl, setExtUrl] = useState('');
  const [extLabel, setExtLabel] = useState('');
  const [customColorInput, setCustomColorInput] = useState('#fef9c3');

  const pinboardRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGetBoard(effectiveScope);
      setBoard({
        mode: data.mode === 'pinboard' ? 'pinboard' : 'columns',
        columns: data.columns?.length ? data.columns : DEFAULT_BOARD.columns,
        cards: Array.isArray(data.cards) ? data.cards : [],
        customColors: Array.isArray(data.customColors) ? data.customColors : []
      });
    } catch {
      setBoard(DEFAULT_BOARD);
    } finally {
      setLoading(false);
    }
  }, [effectiveScope]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard, refreshKey]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const persistBoard = useCallback(
    async (next: BoardData) => {
      setBoard(next);
      try {
        await apiSaveBoard(effectiveScope, next);
      } catch {
        onNotice('บันทึกกระดานไม่สำเร็จ');
      }
    },
    [effectiveScope, onNotice]
  );

  const sortedMeetings = useMemo(() => {
    return [...meetings].sort((a, b) => {
      const keyA = `${a.date || ''} ${a.startTime || ''}`;
      const keyB = `${b.date || ''} ${b.startTime || ''}`;
      return keyB.localeCompare(keyA);
    });
  }, [meetings]);

  const allColors = useMemo(
    () => Array.from(new Set([...PRESET_COLORS, ...(board.customColors || [])])),
    [board.customColors]
  );

  const handleAddCard = (columnId?: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const id = `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const col = columnId || board.columns[0]?.id || 'todo';
    const card: BoardCard = {
      id,
      columnId: col,
      text: trimmed,
      color: allColors[board.cards.length % PRESET_COLORS.length] || '#fef3c7',
      x: 24 + ((board.cards.length * 36) % 360),
      y: 24 + ((board.cards.length * 28) % 180),
      links: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setNewText('');
    setJustAddedIds((prev) => ({ ...prev, [id]: true }));
    window.setTimeout(() => {
      setJustAddedIds((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }, 3200);
    void persistBoard({ ...board, cards: [card, ...board.cards] });
    onNotice('แปะการ์ดใหม่แล้ว');
  };

  const handleDuplicateCard = (card: BoardCard) => {
    const id = `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const copy: BoardCard = {
      ...card,
      id,
      x: (card.x ?? 24) + 24,
      y: (card.y ?? 24) + 24,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    setJustAddedIds((prev) => ({ ...prev, [id]: true }));
    void persistBoard({ ...board, cards: [copy, ...board.cards] });
    onNotice('คัดลอกการ์ดแล้ว');
  };

  const handleUpdateCard = (cardId: string, patch: Partial<BoardCard>) => {
    const nextCards = board.cards.map((c) =>
      c.id === cardId ? { ...c, ...patch, updatedAt: Date.now() } : c
    );
    void persistBoard({ ...board, cards: nextCards });
  };

  const handleAddColumn = () => {
    const title = newColTitle.trim();
    if (!title) return;
    const id = `col-${Date.now().toString(36)}`;
    setNewColTitle('');
    setAddingCol(false);
    void persistBoard({
      ...board,
      columns: [...board.columns, { id, title }]
    });
  };

  const handleAddCustomColor = () => {
    if (!customColorInput) return;
    if (board.customColors.includes(customColorInput)) return;
    void persistBoard({
      ...board,
      customColors: [...board.customColors, customColorInput]
    });
    onNotice('เพิ่มสีใหม่บนกระดานแล้ว');
  };

  const attachLinkToCard = (cardId: string, link: BoardAttachment) => {
    const target = board.cards.find((c) => c.id === cardId);
    if (!target) return;
    const links = [...(target.links || []), link];
    handleUpdateCard(cardId, { links });
    setLinkModalCardId(null);
    setExtUrl('');
    setExtLabel('');
    onNotice('แนบลิงก์ในการ์ดแล้ว');
  };

  const removeLinkFromCard = (cardId: string, linkId: string) => {
    const target = board.cards.find((c) => c.id === cardId);
    if (!target) return;
    handleUpdateCard(cardId, {
      links: (target.links || []).filter((l) => l.id !== linkId)
    });
  };

  const handlePinPointerDown = (e: React.PointerEvent, card: BoardCard) => {
    if (board.mode !== 'pinboard') return;
    if ((e.target as HTMLElement).closest('button, textarea, input, a')) return;
    e.preventDefault();
    dragStateRef.current = {
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: card.x ?? 20,
      origY: card.y ?? 20
    };

    const onMove = (ev: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const dx = ev.clientX - st.startX;
      const dy = ev.clientY - st.startY;
      setBoard((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === st.cardId
            ? { ...c, x: Math.max(8, st.origX + dx), y: Math.max(8, st.origY + dy) }
            : c
        )
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragStateRef.current) {
        dragStateRef.current = null;
        setBoard((latest) => {
          void apiSaveBoard(effectiveScope, latest).catch(() => {});
          return latest;
        });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderCard = (card: BoardCard, inPinboard: boolean) => {
    const isEditing = editingCardId === card.id;
    const isFresh = Boolean(justAddedIds[card.id]);
    return (
      <div
        key={card.id}
        className={`sticky-card ${isFresh ? 'is-fresh' : ''} ${inPinboard ? 'is-pinned' : ''}`}
        style={{
          background: card.color || '#fef3c7',
          ...(inPinboard ? { left: `${card.x ?? 20}px`, top: `${card.y ?? 20}px` } : {})
        }}
        draggable={!inPinboard && !isEditing}
        onDragStart={() => setDragCardId(card.id)}
        onDragEnd={() => setDragCardId(null)}
        onPointerDown={(e) => handlePinPointerDown(e, card)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ cardId: card.id, x: e.clientX, y: e.clientY });
        }}
      >
        <div className="sticky-card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isFresh && <span className="sticky-new-badge">เพิ่งแปะ</span>}
          </div>
          <div className="sticky-card-actions">
            <button
              type="button"
              title="แนบลิงก์"
              onClick={() => setLinkModalCardId(card.id)}
            >
              <Link2 size={12} />
            </button>
            <button
              type="button"
              title="คัดลอกการ์ด"
              onClick={() => handleDuplicateCard(card)}
            >
              <Copy size={12} />
            </button>
            <button
              type="button"
              title="ปิดการ์ด (บันทึกเหตุผล)"
              onClick={() =>
                onRequestClose({
                  itemType: 'card',
                  scope: effectiveScope,
                  title: card.text.slice(0, 60) || 'การ์ดบนกระดาน',
                  idOrPath: card.id,
                  snapshot: card as unknown as Record<string, unknown>
                })
              }
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {isEditing ? (
          <textarea
            className="sticky-edit-input"
            autoFocus
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={() => {
              if (editDraft.trim()) handleUpdateCard(card.id, { text: editDraft.trim() });
              setEditingCardId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editDraft.trim()) handleUpdateCard(card.id, { text: editDraft.trim() });
                setEditingCardId(null);
              }
              if (e.key === 'Escape') setEditingCardId(null);
            }}
          />
        ) : (
          <div
            className="sticky-card-body"
            onDoubleClick={() => {
              setEditingCardId(card.id);
              setEditDraft(card.text);
            }}
            title="ดับเบิลคลิกเพื่อแก้ไข · คลิกขวาเพื่อเมนู"
          >
            {card.text}
          </div>
        )}

        {(card.links?.length ?? 0) > 0 && (
          <div className="sticky-links-row">
            {card.links!.map((lnk) => (
              <span key={lnk.id} className="sticky-link-chip">
                <button
                  type="button"
                  className="sticky-link-open"
                  onClick={() => onNavigateLink(lnk)}
                >
                  {lnk.kind === 'url' ? <ExternalLink size={11} /> : <Link2 size={11} />}
                  <span>{lnk.label}</span>
                  {lnk.date && <span className="sticky-link-date">{lnk.date}</span>}
                </button>
                <button
                  type="button"
                  className="sticky-link-del"
                  title="เอาลิงก์ออก"
                  onClick={() => removeLinkFromCard(card.id, lnk.id)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="sticky-color-dots">
          {allColors.slice(0, 6).map((col) => (
            <button
              key={col}
              type="button"
              className={`sticky-color-dot ${card.color === col ? 'active' : ''}`}
              style={{ background: col }}
              title={`สี ${col}`}
              onClick={() => handleUpdateCard(card.id, { color: col })}
            />
          ))}
        </div>
      </div>
    );
  };

  const contextCard = contextMenu
    ? board.cards.find((c) => c.id === contextMenu.cardId) ?? null
    : null;

  return (
    <div className="insights-card sticky-board-card">
      <div className="sticky-board-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>กระดานแผ่นแปะ</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>
            ลากย้าย คัดลอก คลิกขวา หรือปิดพร้อมบันทึกเหตุผล (บันทึกจริงลง board.json)
          </span>
        </div>

        <div className="sticky-board-controls">
          <div className="v5-pill-switch" role="group" aria-label="โหมดกระดาน">
            <button
              type="button"
              className={board.mode === 'pinboard' ? 'active' : ''}
              onClick={() => void persistBoard({ ...board, mode: 'pinboard' })}
            >
              <LayoutGrid size={13} /> วางอิสระ
            </button>
            <button
              type="button"
              className={board.mode === 'columns' ? 'active' : ''}
              onClick={() => void persistBoard({ ...board, mode: 'columns' })}
            >
              <Kanban size={13} /> คอลัมน์งาน
            </button>
          </div>

          <label className="sticky-custom-color" title="เพิ่มสีการ์ดเอง">
            <Palette size={13} />
            <input
              type="color"
              value={customColorInput}
              onChange={(e) => setCustomColorInput(e.target.value)}
            />
            <button type="button" className="v5-btn" onClick={handleAddCustomColor}>
              + สี
            </button>
          </label>
        </div>
      </div>

      <form
        className="sticky-add-row"
        onSubmit={(e) => {
          e.preventDefault();
          handleAddCard();
        }}
      >
        <input
          className="settings-input"
          style={{ flex: 1 }}
          placeholder="แปะเรื่องที่ต้องทำต่อหรือไอเดียกันลืม…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button type="submit" className="v5-btn primary">
          <Plus size={14} /> แปะการ์ด
        </button>
      </form>

      {loading ? (
        <p className="muted" style={{ fontSize: 13 }}>กำลังโหลดกระดาน…</p>
      ) : board.mode === 'pinboard' ? (
        <div className="sticky-pinboard-canvas" ref={pinboardRef}>
          {board.cards.length === 0 ? (
            <div className="sticky-empty">ยังไม่มีการ์ดบนกระดาน — พิมพ์ด้านบนเพื่อแปะการ์ดแรก</div>
          ) : (
            board.cards.map((card) => renderCard(card, true))
          )}
        </div>
      ) : (
        <div className="sticky-columns-grid">
          {board.columns.map((col) => {
            const colCards = board.cards.filter((c) => (c.columnId || 'todo') === col.id);
            return (
              <div
                key={col.id}
                className="sticky-column"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragCardId) {
                    handleUpdateCard(dragCardId, { columnId: col.id });
                    setDragCardId(null);
                  }
                }}
              >
                <div className="sticky-column-head">
                  <strong>{col.title}</strong>
                  <span className="rail-count">{colCards.length}</span>
                </div>
                <div className="sticky-column-cards">
                  {colCards.map((card) => renderCard(card, false))}
                </div>
              </div>
            );
          })}

          <div className="sticky-column sticky-column-add">
            {addingCol ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  className="settings-input"
                  autoFocus
                  placeholder="ชื่อคอลัมน์ใหม่…"
                  value={newColTitle}
                  onChange={(e) => setNewColTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddColumn();
                    if (e.key === 'Escape') setAddingCol(false);
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="v5-btn primary" onClick={handleAddColumn}>
                    เพิ่ม
                  </button>
                  <button type="button" className="v5-btn" onClick={() => setAddingCol(false)}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="rail-add-btn"
                onClick={() => setAddingCol(true)}
              >
                <Plus size={14} /> เพิ่มคอลัมน์
              </button>
            )}
          </div>
        </div>
      )}

      {contextMenu && contextCard && (
        <div
          className="sticky-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setEditingCardId(contextCard.id);
              setEditDraft(contextCard.text);
              setContextMenu(null);
            }}
          >
            แก้ไขข้อความ
          </button>
          <button
            type="button"
            onClick={() => {
              handleDuplicateCard(contextCard);
              setContextMenu(null);
            }}
          >
            <Copy size={13} /> คัดลอกการ์ด
          </button>
          <button
            type="button"
            onClick={() => {
              setLinkModalCardId(contextCard.id);
              setContextMenu(null);
            }}
          >
            <Link2 size={13} /> แนบลิงก์ใน/นอก
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setContextMenu(null);
              onRequestClose({
                itemType: 'card',
                scope: effectiveScope,
                title: contextCard.text.slice(0, 60) || 'การ์ดบนกระดาน',
                idOrPath: contextCard.id,
                snapshot: contextCard as unknown as Record<string, unknown>
              });
            }}
          >
            <Trash2 size={13} /> ปิดการ์ด (บันทึกเหตุผล)
          </button>
        </div>
      )}

      {linkModalCardId && (
        <div className="v5-modal-backdrop" onClick={() => setLinkModalCardId(null)}>
          <div className="v5-modal" onClick={(e) => e.stopPropagation()}>
            <div className="v5-modal-head">
              <h3>แนบลิงก์ในการ์ด</h3>
              <button
                type="button"
                className="note-mini-icon-btn"
                onClick={() => setLinkModalCardId(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="v5-pill-switch" style={{ alignSelf: 'flex-start' }}>
              <button
                type="button"
                className={linkKind === 'meeting' ? 'active' : ''}
                onClick={() => setLinkKind('meeting')}
              >
                ประชุม (ล่าสุดก่อน)
              </button>
              <button
                type="button"
                className={linkKind === 'note' ? 'active' : ''}
                onClick={() => setLinkKind('note')}
              >
                โน้ต
              </button>
              <button
                type="button"
                className={linkKind === 'url' ? 'active' : ''}
                onClick={() => setLinkKind('url')}
              >
                ลิงก์ภายนอก
              </button>
            </div>

            {linkKind === 'meeting' && (
              <div className="sticky-link-picker-list">
                {sortedMeetings.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>ยังไม่มีบันทึกประชุม</p>
                ) : (
                  sortedMeetings.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="sticky-picker-item"
                      onClick={() =>
                        attachLinkToCard(linkModalCardId, {
                          id: `lnk-${Date.now().toString(36)}`,
                          kind: 'meeting',
                          label: m.title,
                          target: m.id,
                          date: `${m.date} ${m.startTime || ''}`.trim()
                        })
                      }
                    >
                      <strong>{m.title}</strong>
                      <span className="sticky-link-date">
                        {m.date} {m.startTime}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {linkKind === 'note' && (
              <div className="sticky-link-picker-list">
                {notes.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>ยังไม่มีโน้ตในขอบเขตนี้</p>
                ) : (
                  notes.slice(0, 30).map((n) => (
                    <button
                      key={n.path}
                      type="button"
                      className="sticky-picker-item"
                      onClick={() =>
                        attachLinkToCard(linkModalCardId, {
                          id: `lnk-${Date.now().toString(36)}`,
                          kind: 'note',
                          label: n.name,
                          target: n.path
                        })
                      }
                    >
                      <strong>{n.name}</strong>
                      <span className="muted" style={{ fontSize: 11.5 }}>{n.projectSlug}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {linkKind === 'url' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  className="settings-input"
                  placeholder="https://…"
                  value={extUrl}
                  onChange={(e) => setExtUrl(e.target.value)}
                />
                <input
                  className="settings-input"
                  placeholder="ชื่อแสดงบนชิป (ไม่บังคับ)"
                  value={extLabel}
                  onChange={(e) => setExtLabel(e.target.value)}
                />
                <button
                  type="button"
                  className="v5-btn primary"
                  disabled={!extUrl.trim()}
                  onClick={() =>
                    attachLinkToCard(linkModalCardId, {
                      id: `lnk-${Date.now().toString(36)}`,
                      kind: 'url',
                      label: extLabel.trim() || extUrl.trim(),
                      target: extUrl.trim()
                    })
                  }
                >
                  แนบลิงก์
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
