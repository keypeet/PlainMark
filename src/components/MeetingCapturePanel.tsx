import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Copy, Download, FileVideo, ScanText, Trash2, X } from 'lucide-react';

interface MeetingCapturePanelProps {
  meetingTitle: string;
  onNotice: (msg: string) => void;
  onVideoOpenChange?: (open: boolean) => void;
}

type CaptureKind = 'frame' | 'ocr';

interface Capture {
  id: string;
  kind: CaptureKind;
  time: number;
  blob: Blob;
  url: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_REGION_PX = 8;

export function formatMediaTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Where the frame is actually drawn inside the <video> box (object-fit: contain letterboxing).
function videoContentRect(video: HTMLVideoElement): Rect {
  const elW = video.clientWidth;
  const elH = video.clientHeight;
  const vw = video.videoWidth || elW;
  const vh = video.videoHeight || elH;
  const scale = Math.min(elW / vw, elH / vh) || 1;
  const w = vw * scale;
  const h = vh * scale;
  return { x: (elW - w) / 2, y: (elH - h) / 2, w, h };
}

export function MeetingCapturePanel({
  meetingTitle,
  onNotice,
  onVideoOpenChange
}: MeetingCapturePanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [region, setRegion] = useState<Rect | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);

  const capturesRef = useRef(captures);
  capturesRef.current = captures;

  useEffect(() => {
    onVideoOpenChange?.(!!videoUrl);
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      onVideoOpenChange?.(false);
    };
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      capturesRef.current.forEach((c) => URL.revokeObjectURL(c.url));
    };
  }, []);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelSelecting();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  const openFile = (file: File) => {
    setVideoUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setReady(false);
    setLoadError('');
    cancelSelecting();
  };

  const cancelSelecting = () => {
    setSelecting(false);
    setRegion(null);
    dragStart.current = null;
  };

  const startSelecting = () => {
    videoRef.current?.pause();
    setRegion(null);
    setSelecting(true);
  };

  // Crops in display pixels are mapped back to the video's native resolution.
  const grabFrame = async (kind: CaptureKind, crop: Rect | null) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (crop) {
      const content = videoContentRect(video);
      const k = vw / content.w;
      sx = Math.round((crop.x - content.x) * k);
      sy = Math.round((crop.y - content.y) * k);
      sw = Math.round(crop.w * k);
      sh = Math.round(crop.h * k);
    }
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onNotice('แคปภาพไม่สำเร็จ: เบราว์เซอร์ไม่รองรับ canvas');
      return;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      onNotice('แคปภาพไม่สำเร็จ');
      return;
    }
    const capture: Capture = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      time: video.currentTime,
      blob,
      url: URL.createObjectURL(blob)
    };
    setCaptures((prev) => [capture, ...prev]);
  };

  const sendRegionToOcr = async () => {
    if (!region) return;
    await grabFrame('ocr', region);
    cancelSelecting();
  };

  const contentBounds = () => {
    const video = videoRef.current;
    return video ? videoContentRect(video) : null;
  };

  const localPoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const bounds = contentBounds();
    let x = e.clientX - box.left;
    let y = e.clientY - box.top;
    if (bounds) {
      x = Math.min(Math.max(x, bounds.x), bounds.x + bounds.w);
      y = Math.min(Math.max(y, bounds.y), bounds.y + bounds.h);
    }
    return { x, y };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = localPoint(e);
    dragStart.current = p;
    setRegion({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const p = localPoint(e);
    setRegion({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y)
    });
  };

  const onPointerUp = () => {
    dragStart.current = null;
    setRegion((r) => (r && r.w >= MIN_REGION_PX && r.h >= MIN_REGION_PX ? r : null));
  };

  const removeCapture = (id: string) => {
    setCaptures((prev) => {
      const hit = prev.find((c) => c.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((c) => c.id !== id);
    });
  };

  const copyCapture = async (c: Capture) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [c.blob.type]: c.blob })]);
      onNotice('คัดลอกรูปแล้ว วางในแอปอื่นได้เลย');
    } catch {
      onNotice('คัดลอกรูปไม่สำเร็จ ลองกดดาวน์โหลดแทน');
    }
  };

  const downloadName = (c: Capture) => {
    const base = (meetingTitle || 'meeting').replace(/[\\/:*?"<>|]+/g, '-').trim();
    const stamp = formatMediaTime(c.time).replace(/:/g, '-');
    return `${base}-${stamp}${c.kind === 'ocr' ? '-ocr' : ''}.png`;
  };

  const seekTo = (sec: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = sec;
  };

  const hasRegion = !!region && region.w >= MIN_REGION_PX && region.h >= MIN_REGION_PX;

  return (
    <section className="meeting-capture-panel" data-testid="meeting-capture-panel">
      <div className="meeting-capture-head">
        <FileVideo size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 13.5 }}>วิดีโอประชุม</strong>
          <div className="muted meeting-capture-filename">
            {fileName || 'เปิดไฟล์ .mp4 จาก OBS เพื่อแคปภาพหรือเลือกพื้นที่ไปอ่านข้อความ'}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
          hidden
          data-testid="meeting-video-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openFile(file);
            e.target.value = '';
          }}
        />
        <button type="button" className="v5-btn" onClick={() => fileInputRef.current?.click()}>
          {videoUrl ? 'เปลี่ยนไฟล์' : 'เปิดไฟล์วิดีโอ'}
        </button>
      </div>

      {videoUrl && (
        <>
          <div className="meeting-capture-stage">
            <video
              ref={videoRef}
              src={videoUrl}
              controls={!selecting}
              preload="metadata"
              data-testid="meeting-video"
              onLoadedMetadata={() => setReady(true)}
              onError={() => {
                setReady(false);
                setLoadError('เบราว์เซอร์เล่นไฟล์นี้ไม่ได้ ถ้าเป็น .mkv ให้ remux เป็น .mp4 ใน OBS ก่อน');
              }}
            />
            {selecting && (
              <div
                className="meeting-capture-overlay"
                data-testid="ocr-region-overlay"
                aria-label="ลากเพื่อเลือกพื้นที่ที่จะอ่านข้อความ"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {region && region.w > 0 && (
                  <div
                    className="meeting-capture-region"
                    style={{ left: region.x, top: region.y, width: region.w, height: region.h }}
                  />
                )}
                {!region && <span className="meeting-capture-hint">ลากกรอบรอบส่วนที่ต้องการอ่านข้อความ</span>}
              </div>
            )}
          </div>

          {loadError && <div className="meetings-inline-feedback">{loadError}</div>}

          <div className="meeting-capture-toolbar">
            {selecting ? (
              <>
                <span className="muted" style={{ fontSize: 12.5, flex: 1 }}>
                  {hasRegion ? 'ลากใหม่เพื่อปรับกรอบได้' : 'ลากกรอบบนภาพ · กด Esc เพื่อยกเลิก'}
                </span>
                <button type="button" className="v5-btn" onClick={cancelSelecting}>
                  <X size={14} /> ยกเลิก
                </button>
                <button
                  type="button"
                  className="v5-btn primary"
                  disabled={!hasRegion}
                  onClick={() => void sendRegionToOcr()}
                >
                  <ScanText size={14} /> เก็บกรอบนี้ไปอ่านข้อความ
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="v5-btn"
                  disabled={!ready}
                  onClick={() => void grabFrame('frame', null)}
                >
                  <Camera size={14} /> แคปภาพทั้งจอ
                </button>
                <button type="button" className="v5-btn" disabled={!ready} onClick={startSelecting}>
                  <ScanText size={14} /> เลือกพื้นที่อ่านข้อความ
                </button>
              </>
            )}
          </div>

          {captures.length > 0 && (
            <ul className="meetings-keyframes-strip meeting-capture-tray" data-testid="capture-tray">
              {captures.map((c) => (
                <li key={c.id} className="keyframe-thumb-card">
                  <button
                    type="button"
                    className="keyframe-16x9"
                    title="ไปยังจังหวะนี้ในวิดีโอ"
                    onClick={() => seekTo(c.time)}
                  >
                    <img src={c.url} alt={`ภาพที่ ${formatMediaTime(c.time)}`} />
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {formatMediaTime(c.time)}
                    </span>
                    <span className={`meeting-badge ${c.kind === 'ocr' ? 'inbox' : 'local'}`}>
                      {c.kind === 'ocr' ? 'รออ่านข้อความ' : 'ภาพ'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      aria-label="คัดลอกรูป"
                      title="คัดลอกรูป"
                      onClick={() => void copyCapture(c)}
                    >
                      <Copy size={16} />
                    </button>
                    <a
                      className="note-mini-icon-btn"
                      href={c.url}
                      download={downloadName(c)}
                      aria-label="ดาวน์โหลดรูป"
                      title="ดาวน์โหลดรูป"
                    >
                      <Download size={16} />
                    </a>
                    <button
                      type="button"
                      className="note-mini-icon-btn"
                      aria-label="ลบรูปนี้"
                      title="ลบรูปนี้"
                      onClick={() => removeCapture(c.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
