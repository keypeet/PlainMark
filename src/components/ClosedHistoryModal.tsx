import { useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useNotesStore } from '../store/notesStore';

interface ClosedHistoryModalProps {
  open: boolean;
  onClose: () => void;
  onNotice: (message: string) => void;
}

export function ClosedHistoryModal({ open, onClose, onNotice }: ClosedHistoryModalProps) {
  const { closedItems, refreshClosedItems, restoreClosedItem } = useNotesStore();

  useEffect(() => {
    if (open) void refreshClosedItems();
  }, [open, refreshClosedItems]);

  if (!open) return null;

  return (
    <div className="v5-modal-backdrop" onMouseDown={onClose}>
      <div className="v5-modal" style={{ width: 'min(620px, 100%)' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-row">
          <h3>ประวัติที่ปิดแล้ว ({closedItems.length})</h3>
          <button type="button" className="note-mini-icon-btn" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        {closedItems.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5, margin: '8px 0' }}>
            ยังไม่มีรายการที่ปิดไว้
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {closedItems.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--rule)',
                  background: 'var(--surface-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {item.title || '(ไม่มีชื่อ)'}{' '}
                    <span className="rail-count">{item.itemType}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    เหตุผล: {item.reason}
                    {item.assignee ? ` · ผู้รับต่อ: ${item.assignee}` : ''}
                    {item.note ? ` · ${item.note}` : ''}
                  </div>
                </div>
                {item.restored ? (
                  <span className="ok-text" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    กู้คืนแล้ว
                  </span>
                ) : (
                  <button
                    type="button"
                    className="v5-btn"
                    onClick={() => {
                      void restoreClosedItem(item.id).then(() => onNotice('กู้คืนรายการแล้ว'));
                    }}
                  >
                    <RotateCcw size={13} /> กู้คืน
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
