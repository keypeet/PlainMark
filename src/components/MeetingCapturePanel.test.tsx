import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMediaTime, MeetingCapturePanel } from './MeetingCapturePanel';

function openVideo() {
  const input = screen.getByTestId('meeting-video-input') as HTMLInputElement;
  const file = new File(['x'], '2026-11-23 10-27-57.mp4', { type: 'video/mp4' });
  fireEvent.change(input, { target: { files: [file] } });
  return screen.getByTestId('meeting-video') as HTMLVideoElement;
}

describe('MeetingCapturePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:video'), revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('formats media timestamps', () => {
    expect(formatMediaTime(0)).toBe('00:00');
    expect(formatMediaTime(65.9)).toBe('01:05');
    expect(formatMediaTime(3110)).toBe('51:50');
    expect(formatMediaTime(3725)).toBe('1:02:05');
  });

  it('shows only the open-file prompt until a video is chosen', () => {
    render(<MeetingCapturePanel meetingTitle="Weekly" onNotice={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'เปิดไฟล์วิดีโอ' })).toBeTruthy();
    expect(screen.queryByTestId('meeting-video')).toBeNull();
  });

  it('enables capture tools once the video metadata loads', () => {
    render(<MeetingCapturePanel meetingTitle="Weekly" onNotice={vi.fn()} />);
    const video = openVideo();

    expect(screen.getByText('2026-11-23 10-27-57.mp4')).toBeTruthy();
    const captureBtn = screen.getByRole('button', { name: /แคปภาพทั้งจอ/ }) as HTMLButtonElement;
    expect(captureBtn.disabled).toBe(true);

    fireEvent.loadedMetadata(video);
    expect(captureBtn.disabled).toBe(false);
  });

  it('reports when a video is open so the audio-only bar can hide', () => {
    const onVideoOpenChange = vi.fn();
    const { unmount } = render(
      <MeetingCapturePanel meetingTitle="Weekly" onNotice={vi.fn()} onVideoOpenChange={onVideoOpenChange} />
    );
    expect(onVideoOpenChange).toHaveBeenLastCalledWith(false);
    openVideo();
    expect(onVideoOpenChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onVideoOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('enters region-select mode and leaves it with Escape', () => {
    render(<MeetingCapturePanel meetingTitle="Weekly" onNotice={vi.fn()} />);
    const video = openVideo();
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
