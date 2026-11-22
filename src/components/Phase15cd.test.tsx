import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeView } from './KnowledgeView';
import { MeetingsView } from './MeetingsView';
import { StickyBoard } from './StickyBoard';

const mockBoard = {
  mode: 'columns' as const,
  columns: [
    { id: 'todo', title: 'ต้องทำต่อ' },
    { id: 'doing', title: 'กำลังทำ' }
  ],
  cards: [
    {
      id: 'card-1',
      columnId: 'todo',
      text: 'ทดสอบการ์ด',
      color: '#fef3c7',
      links: []
    }
  ],
  customColors: []
};

describe('Phase 1.5c–1.5d UI Components', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('StickyBoard toggles between Pinboard and Columns mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/board') && (!init || init.method !== 'PUT')) {
        return new Response(JSON.stringify(mockBoard), { status: 200 });
      }
      if (url.includes('/api/board') && init?.method === 'PUT') {
        return new Response(init.body as string, { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StickyBoard
        scope="general"
        notes={[]}
        meetings={[]}
        onRequestClose={vi.fn()}
        onNavigateLink={vi.fn()}
        onNotice={vi.fn()}
      />
    );

    await screen.findByText('ทดสอบการ์ด');
    const pinBtn = screen.getByRole('button', { name: /วางอิสระ/i });
    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/board?scope=general'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  it('MeetingsView renders real empty state and Audio-Only layout hides keyframes strip', async () => {
    const audioOnlyMeeting = {
      id: 'mtg-audio-1',
      scope: 'general',
      title: 'ประชุมเสียงล้วน',
      date: '2026-11-22',
      startTime: '10:00',
      endTime: '10:30',
      visibility: 'local_only',
      participants: [],
      summary: 'สรุปประชุม',
      actionItems: [],
      keyframes: [],
      segments: [],
      createdAt: 1000,
      updatedAt: 1000
    };

    let listResponse = { items: [], total: 0, inboxItems: [], brokenItems: [] } as Record<string, unknown>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/meetings/mtg-audio-1/history')) {
          return new Response(JSON.stringify({ snapshots: [] }), { status: 200 });
        }
        if (url.includes('/api/meetings/mtg-audio-1')) {
          return new Response(JSON.stringify(audioOnlyMeeting), { status: 200 });
        }
        if (url.includes('/api/meetings')) {
          return new Response(JSON.stringify(listResponse), { status: 200 });
        }
        if (url.includes('/api/voiceprints')) {
          return new Response(JSON.stringify({ voiceprints: [] }), { status: 200 });
        }
        if (url.includes('/api/contacts')) {
          return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      })
    );

    const { rerender } = render(<MeetingsView onNotice={vi.fn()} />);
    await screen.findByText(/ยังไม่มีบันทึกประชุมในขอบเขตนี้/i);

    listResponse = { items: [audioOnlyMeeting], total: 1, inboxItems: [], brokenItems: [] };
    rerender(<MeetingsView onNotice={vi.fn()} />);

    // Open meeting from a fresh mount with item present
    const { unmount } = render(<MeetingsView onNotice={vi.fn()} />);
    const row = await screen.findByText('ประชุมเสียงล้วน');
    fireEvent.click(row);

    await screen.findByTestId('audio-only-player');
    expect(screen.queryByTestId('keyframes-strip')).toBeNull();
    expect(screen.queryByRole('button', { name: /สไลด์/i })).toBeNull();
    unmount();
  });

  it('KnowledgeView renders real empty state when no knowledge items exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    );

    render(<KnowledgeView onNotice={vi.fn()} />);
    await screen.findByText(/ยังไม่มีความรู้ที่บันทึกไว้/i);
  });
});
