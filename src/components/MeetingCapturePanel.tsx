import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react';
import { Camera, FileVideo, ScanText, X } from 'lucide-react';
import {
  apiAddMeetingCapture,
  apiListMediaVideos,
  apiUpdateMeeting,
  mediaFileUrl,
  type MediaVideoItem,
  type MeetingKeyframe,
  type MeetingRecord
} from '../lib/api';

interface MeetingCapturePanelProps {
  meeting: MeetingRecord;
  videoRef: RefObject<HTMLVideoElement>;
  onMeetingChange: (meeting: MeetingRecord) => void;
  onNotice: (msg: string) => void;
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

export function captureFileName(meetingTitle: string, kf: MeetingKeyframe): string {
  const base = (meetingTitle || 'meeting').replace(/[\\/:*?"<>|]+/g, '-').trim();
  const stamp = (kf.timestamp || formatMediaTime(kf.timeSec ?? 0)).replace(/:/g, '-');
  return `${base}-${stamp}${kf.kind === 'ocr' ? '-ocr' : ''}.png`;
}

export async function copyImageToClipboard(url: string): Promise<void> {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  });
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function videoOptionLabel(v: MediaVideoItem): string {
  const when = new Date(v.modifiedAt).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const gb = v.size / 1024 ** 3;
  const size = gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(v.size / 1024 ** 2))} MB`;
  return `${v.folder ? `${v.folder}\\` : ''}${v.name} · ${when} · ${size}`;
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
  meeting,
  videoRef,
  onMeetingChange,
  onNotice
}: MeetingCapturePanelProps) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [choosing, setChoosing] = useState(false);
  const [mediaRoot, setMediaRoot] = useState('');
  const [videos, setVideos] = useState<MediaVideoItem[] | null>(null);
  const [pickedPath, setPickedPath] = useState('');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [region, setRegion] = useState<Rect | null>(null);
  const [saving, setSaving] = useState(false);

  const videoPath = meeting.videoPath || '';

  useEffect(() => {
    setReady(false);
    setLoadError('');
  }, [videoPath]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelSelecting();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  const openChooser = async () => {
    setChoosing(true);
    try {
      const res = await apiListMediaVideos();
      setMediaRoot(res.root);
      setVideos(res.items);
      const sameDay = res.items.find((v) => {
        const d = new Date(v.modifiedAt);
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return local === meeting.date;
      });
      setPickedPath(videoPath || sameDay?.path || res.items[0]?.path || '');
    } catch {
      setVideos([]);
      onNotice('โหลดรายการวิดีโอไม่สำเร็จ');
    }
  };

  const linkVideo = async () => {
    if (!pickedPath) return;
    try {
      const updated = await apiUpdateMeeting(meeting.id, { videoPath: pickedPath });
      onMeetingChange(updated);
      setChoosing(false);
      cancelSelecting();
    } catch {
      onNotice('ผูกวิดีโอไม่สำเร็จ ไฟล์ต้องอยู่ในโฟลเดอร์ไฟล์อัด');
    }
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
  const saveCapture = async (kind: 'frame' | 'ocr', crop: Rect | null) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || saving) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let native = { x: 0, y: 0, w: vw, h: vh };
    if (crop) {
      const content = videoContentRect(video);
      const k = vw / content.w;
      native = {
        x: Math.round((crop.x - content.x) * k),
        y: Math.round((crop.y - content.y) * k),
        w: Math.round(crop.w * k),
        h: Math.round(crop.h * k)
      };
    }
    const canvas = document.createElement('canvas');
    canvas.width = native.w;
    canvas.height = native.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onNotice('แคปภาพไม่สำเร็จ: เบราว์เซอร์ไม่รองรับ canvas');
      return;
    }
    ctx.drawImage(video, native.x, native.y, native.w, native.h, 0, 0, native.w, native.h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      onNotice('แคปภาพไม่สำเร็จ');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiAddMeetingCapture(
        meeting.id,
        blob,
        video.currentTime,
        kind,
        crop ? native : undefined
      );
      onMeetingChange(updated);
      const added = updated.keyframes?.find((k) => !meeting.keyframes?.some((o) => o.id === k.id));
      onNotice(
        kind === 'frame'
          ? 'เก็บภาพไว้ในสไลด์ของประชุมแล้ว'
          : added?.ocrStatus === 'done'
            ? added.ocrText
              ? 'อ่านข้อความจากกรอบแล้ว ดูได้ในสไลด์ของประชุม'
              : 'เก็บกรอบแล้ว แต่ไม่พบข้อความในกรอบนี้'
            : 'เก็บกรอบแล้ว แต่ยังอ่านข้อความไม่ได้ กดอ่านอีกครั้งที่การ์ดสไลด์'
      );
    } catch {
      onNotice('บันทึกภาพไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const sendRegionToOcr = async () => {
    if (!region) return;
    await saveCapture('ocr', region);
    cancelSelecting();
  };

  const localPoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const video = videoRef.current;
    const bounds = video ? videoContentRect(video) : null;
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

  const hasRegion = !!region && region.w >= MIN_REGION_PX && region.h >= MIN_REGION_PX;

  return (
    <section className="meeting-capture-panel" data-testid="meeting-capture-panel">
      <div className="meeting-capture-head">
        <FileVideo size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 13.5 }}>วิดีโอประชุม</strong>
          <div className="muted meeting-capture-filename" title={videoPath || undefined}>
            {videoPath
              ? baseName(videoPath)
              : 'ผูกไฟล์อัดจาก OBS เพื่อแคปภาพหรือเลือกพื้นที่ไปอ่านข้อความ ไฟล์อยู่ที่เดิม ไม่ถูกคัดลอก'}
          </div>
        </div>
        {!choosing && (
          <button type="button" className="v5-btn" onClick={() => void openChooser()}>
            {videoPath ? 'เปลี่ยนวิดีโอ' : 'เลือกวิดีโอ'}
          </button>
        )}
      </div>

      {choosing && (
        <div className="meeting-capture-toolbar" data-testid="video-chooser">
          {videos === null ? (
            <span className="muted" style={{ fontSize: 12.5, flex: 1 }}>
              กำลังโหลดรายการวิดีโอ…
            </span>
          ) : videos.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5, flex: 1 }}>
              ไม่พบไฟล์ .mp4 / .webm / .mov ใน <code>{mediaRoot || 'โฟลเดอร์ไฟล์อัด'}</code> ตั้งโฟลเดอร์ได้ที่
              ตั้งค่า › ประชุมและเสียง › Watch Folder
            </span>
          ) : (
            <select
              className="settings-select"
              style={{ flex: 1, minWidth: 0 }}
              aria-label="ไฟล์วิดีโอในโฟลเดอร์ไฟล์อัด"
              value={pickedPath}
              onChange={(e) => setPickedPath(e.target.value)}
            >
              {videos.map((v) => (
                <option key={v.path} value={v.path}>
                  {videoOptionLabel(v)}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="v5-btn" onClick={() => setChoosing(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="v5-btn primary"
            disabled={!pickedPath || !videos?.length}
            onClick={() => void linkVideo()}
          >
            ผูกวิดีโอนี้
          </button>
        </div>
      )}

      {videoPath && (
        <>
          <div className="meeting-capture-stage">
            <video
              ref={videoRef}
              src={mediaFileUrl(videoPath)}
              controls={!selecting}
              preload="metadata"
              data-testid="meeting-video"
              onLoadedMetadata={() => setReady(true)}
              onError={() => {
                setReady(false);
                setLoadError('เปิดวิดีโอไม่ได้ ไฟล์อาจถูกย้ายหรือลบ ลองกด "เปลี่ยนวิดีโอ"');
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
                  disabled={!hasRegion || saving}
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
                  disabled={!ready || saving}
                  onClick={() => void saveCapture('frame', null)}
                >
                  <Camera size={14} /> แคปภาพทั้งจอ
                </button>
                <button
                  type="button"
                  className="v5-btn"
                  disabled={!ready || saving}
                  onClick={startSelecting}
                >
                  <ScanText size={14} /> เลือกพื้นที่อ่านข้อความ
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
