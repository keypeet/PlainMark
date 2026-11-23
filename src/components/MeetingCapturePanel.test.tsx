import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeetingRecord } from '../lib/api';
import { captureFileName, formatMediaTime, MeetingCapturePanel } from './MeetingCapturePanel';

const baseMeeting: MeetingRecord = {
  id: 'mtg-1',
  scope: 'general',
  title: 'Weekly',
  date: '2026-11-23',
  startTime: '10:27',
  endTime: '',
  visibility: 'local_only',
  participants: [],
  summary: '',
  actionItems: [],
  keyframes: [],
  createdAt: 0,
  updatedAt: 0
};

const videoPath = 'C:\\Users\\me\\Videos\\Meetings\\2026-11-23 10-27-57.mp4';

function renderPanel(meeting: MeetingRecord, onMeetingChange = vi.fn()) {
  render(
    <MeetingCapturePanel
      meeting={meeting}
      videoRef={createRef<HTMLVideoElement>()}
      onMeetingChange={onMeetingChange}
      onNotice={vi.fn()}
    />
  );
  return onMeetingChange;
}

describe('MeetingCapturePanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('formats media timestamps and download names', () => {
    expect(formatMediaTime(0)).toBe('00:00');
    expect(formatMediaTime(65.9)).toBe('01:05');
    expect(formatMediaTime(3725)).toBe('1:02:05');
    expect(captureFileName('Q4: plan', { timestamp: '1:02:05', kind: 'ocr' })).toBe(
      'Q4- plan-1-02-05-ocr.png'
    );
  });

  it('lists recordings and links the one from the meeting day in place', async () => {
    const linked = { ...baseMeeting, videoPath };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/media/videos')) {
        return new Response(
          JSON.stringify({
            root: 'C:\\Users\\me\\Videos',
            items: [
              {
                path: 'C:\\Users\\me\\Videos\\other.mp4',
                name: 'other.mp4',
                folder: '',
                size: 1e6,
                modifiedAt: new Date(2026, 10, 24, 9).getTime()
              },
              {
                path: videoPath,
                name: '2026-11-23 10-27-57.mp4',
                folder: 'Meetings',
                size: 2.07e9,
                modifiedAt: new Date(2026, 10, 23, 11, 19).getTime()
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes('/api/meetings/mtg-1') && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ videoPath });
        return new Response(JSON.stringify(linked), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onMeetingChange = renderPanel(baseMeeting);
    expect(screen.queryByTestId('meeting-video')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'เลือกวิดีโอ' }));
    const select = (await screen.findByRole('combobox', {
      name: 'ไฟล์วิดีโอในโฟลเดอร์ไฟล์อัด'
    })) as HTMLSelectElement;
    expect(select.value).toBe(videoPath);

    fireEvent.click(screen.getByRole('button', { name: 'ผูกวิดีโอนี้' }));
    await waitFor(() => expect(onMeetingChange).toHaveBeenCalledWith(linked));
  });

  it('streams a linked video from the backend and enables tools after metadata loads', () => {
    renderPanel({ ...baseMeeting, videoPath });
    const video = screen.getByTestId('meeting-video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(`/api/media/file?path=${encodeURIComponent(videoPath)}`);
    expect(screen.getByText('2026-11-23 10-27-57.mp4')).toBeTruthy();

    const captureBtn = screen.getByRole('button', { name: /แคปภาพทั้งจอ/ }) as HTMLButtonElement;
    expect(captureBtn.disabled).toBe(true);
    fireEvent.loadedMetadata(video);
    expect(captureBtn.disabled).toBe(false);
  });

  it('enters region-select mode and leaves it with Escape', () => {
    renderPanel({ ...baseMeeting, videoPath });
    const video = screen.getByTestId('meeting-video') as HTMLVideoElement;
    video.pause = vi.fn();
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole('button', { name: /เลือกพื้นที่อ่านข้อความ/ }));
    expect(video.pause).toHaveBeenCalled();
    expect(screen.getByTestId('ocr-region-overlay')).toBeTruthy();
    const keepBtn = screen.getByRole('button', { name: /เก็บกรอบนี้ไปอ่านข้อความ/ }) as HTMLButtonElement;
    expect(keepBtn.disabled).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('ocr-region-overlay')).toBeNull();
  });
});
