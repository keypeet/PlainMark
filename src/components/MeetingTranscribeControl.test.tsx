import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeetingAsr } from '../lib/api';
import { MeetingTranscribeControl } from './MeetingTranscribeControl';

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return new Response(JSON.stringify(handler(String(input), init)), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderControl(hasVideo = true, onTranscribed = vi.fn()) {
  render(
    <MeetingTranscribeControl
      meetingId="mtg-1"
      hasVideo={hasVideo}
      hasTranscript={false}
      onTranscribed={onTranscribed}
      onNotice={vi.fn()}
    />
  );
  return onTranscribed;
}

describe('MeetingTranscribeControl', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows nothing until a video is linked', () => {
    stubFetch(() => ({ status: 'none' }));
    renderControl(false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows progress while a run is going', async () => {
    stubFetch(() => ({ status: 'running', piecesDone: 30, pieces: 120 }));
    renderControl();
    expect((await screen.findByRole('status')).textContent).toContain('กำลังถอดเสียง 25%');
  });

  it('starts a run and reloads the transcript when it finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: MeetingAsr = { status: 'none' };
    const fetchMock = stubFetch((url, init) => {
      if (init?.method === 'POST') state = { status: 'running', piecesDone: 0, pieces: 10 };
      return state;
    });
    const onTranscribed = renderControl();
    fireEvent.click(await screen.findByRole('button', { name: /ถอดเสียง/ }));
    expect((await screen.findByRole('status')).textContent).toContain('0%');
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/transcribe'))).toBe(true);

    state = { status: 'done', segmentCount: 4 };
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(onTranscribed).toHaveBeenCalledTimes(1));
  });
});
