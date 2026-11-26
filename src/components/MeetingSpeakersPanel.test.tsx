import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeetingDiarization, VoiceprintItem } from '../lib/api';
import { MeetingSpeakersPanel, nextTurnStart } from './MeetingSpeakersPanel';

const done: MeetingDiarization = {
  status: 'done',
  durationSec: 100,
  voiceprints: 'done',
  speakers: [
    { id: 'spk1', talkSec: 60, share: 0.6, isMe: false, canRemember: true },
    {
      id: 'spk2',
      talkSec: 40,
      share: 0.4,
      isMe: true,
      canRemember: true,
      suggestedVoiceprintId: 'vp-bo',
      suggestedName: 'Bo'
    }
  ],
  turns: [
    { speakerId: 'spk1', start: 0, end: 30 },
    { speakerId: 'spk2', start: 30, end: 70 },
    { speakerId: 'spk1', start: 70, end: 100 }
  ]
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return new Response(JSON.stringify(handler(String(input), init)), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(
  voiceprints: VoiceprintItem[] = [],
  onVoiceprintsChange = vi.fn(),
  onSpeakersChange = vi.fn()
) {
  render(
    <MeetingSpeakersPanel
      meetingId="mtg-1"
      videoRef={createRef<HTMLVideoElement>()}
      voiceprints={voiceprints}
      onVoiceprintsChange={onVoiceprintsChange}
      onSpeakersChange={onSpeakersChange}
      onNotice={vi.fn()}
    />
  );
  return onVoiceprintsChange;
}

describe('MeetingSpeakersPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('jumps to the next turn of a speaker and wraps to their first', () => {
    const turns = done.turns!;
    expect(nextTurnStart(turns, 'spk1', 5)).toBe(70);
    expect(nextTurnStart(turns, 'spk1', 80)).toBe(0);
    expect(nextTurnStart(turns, 'spk9', 0)).toBeNull();
  });

  it('starts diarization when none has run yet', async () => {
    const fetchMock = stubFetch((url, init) =>
      init?.method === 'POST' && url.endsWith('/diarize') ? { status: 'running' } : { status: 'none' }
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /แยกผู้พูด/ }));
    expect((await screen.findByRole('status')).textContent).toContain('กำลังแยกผู้พูด');
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/meetings/mtg-1/diarize'))).toBe(
      true
    );
  });

  it('lists speakers by share, marks the mic speaker and confirms a suggested name', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (init?.method === 'POST' && url.includes('/diarization/speakers/spk2')) {
        return {
          ...done,
          speakers: [done.speakers![0], { ...done.speakers![1], name: 'Bo', voiceprintId: 'vp-bo' }]
        };
      }
      return done;
    });
    const onVoiceprintsChange = renderPanel();
    const row2 = await screen.findByTestId('speaker-spk2');
    expect(screen.getByTestId('speaker-spk1').textContent).toContain('ผู้พูด 1');
    expect(screen.getByTestId('speaker-spk1').textContent).toContain('60%');
    expect(row2.textContent).toContain('ฉัน');
    expect(row2.textContent).toContain('เสียงคล้าย Bo');

    fireEvent.click(screen.getByRole('button', { name: 'ใช่' }));
    await waitFor(() => expect(screen.getByTestId('speaker-spk2').textContent).toContain('Bo'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: 'Bo',
      remember: true,
      voiceprintId: 'vp-bo'
    });
    expect(onVoiceprintsChange).toHaveBeenCalled();
  });

  it('names a speaker for this meeting only unless remember is ticked', async () => {
    const fetchMock = stubFetch(() => done);
    const onVoiceprintsChange = renderPanel();
    await screen.findByTestId('speaker-spk1');
    fireEvent.click(screen.getAllByRole('button', { name: 'ตั้งชื่อ' })[0]);
    fireEvent.change(screen.getByLabelText('ชื่อผู้พูด'), { target: { value: 'Ann' } });
    expect((screen.getByLabelText('จำเสียงไว้ใช้ประชุมต่อไป') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(String(post?.[0])).toContain('/diarization/speakers/spk1');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'Ann', remember: false });
    expect(onVoiceprintsChange).not.toHaveBeenCalled();
  });

  it('tells the page to reload transcript labels after naming a speaker', async () => {
    stubFetch(() => done);
    const onSpeakersChange = vi.fn();
    renderPanel([], vi.fn(), onSpeakersChange);
    await screen.findByTestId('speaker-spk1');
    fireEvent.click(screen.getAllByRole('button', { name: 'ตั้งชื่อ' })[0]);
    fireEvent.change(screen.getByLabelText('ชื่อผู้พูด'), { target: { value: 'Ann' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(onSpeakersChange).toHaveBeenCalledTimes(1));
  });

  it('offers Forget only for a speaker whose voiceprint is saved', async () => {
    const saved = {
      ...done,
      speakers: [{ ...done.speakers![0], name: 'Ann', voiceprintId: 'vp-ann' }, done.speakers![1]]
    };
    const fetchMock = stubFetch(() => saved);
    vi.stubGlobal('confirm', () => true);
    const vp = { id: 'vp-ann', name: 'Ann' } as VoiceprintItem;
    const onVoiceprintsChange = renderPanel([vp]);
    await screen.findByTestId('speaker-spk1');
    expect(screen.getAllByRole('button', { name: 'ลืมเสียง' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'ลืมเสียง' }));
    await waitFor(() => expect(onVoiceprintsChange).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => String(u).endsWith('/api/voiceprints/vp-ann') && init?.method === 'DELETE'
      )
    ).toBe(true);
  });
});
