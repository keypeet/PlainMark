import { useCallback, useEffect } from 'react';
import { hasTauri, tauriWebview } from '../lib/platform';
import { useSettingsStore } from '../store/settingsStore';

// ซูมทั้งแอป — คุมค่าใน settingsStore, ปรับจริงผ่าน webview และรองรับ Ctrl+ลูกกลิ้งเมาส์
// คืนฟังก์ชัน changeZoom (delta เป็นขั้น ±0.1, null = รีเซ็ตกลับ 100%)
export function useAppZoom(showNotice: (message: string) => void) {
  const zoom = useSettingsStore((state) => state.zoom);

  const changeZoom = useCallback(
    (delta: number | null) => {
      const { zoom: current, setZoom } = useSettingsStore.getState();
      setZoom(delta === null ? 1 : current + delta);
      showNotice(`ซูม ${Math.round(useSettingsStore.getState().zoom * 100)}%`);
    },
    [showNotice]
  );

  // ปรับซูมจริงผ่าน webview ทุกครั้งที่ค่าเปลี่ยน (รวมตอนเปิดแอป — คืนค่าที่จำไว้)
  useEffect(() => {
    if (!hasTauri) return;
    tauriWebview()
      .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(zoom))
      .catch((error) => console.error('PlainMark: set zoom failed', error));
  }, [zoom]);

  // Ctrl + ลูกกลิ้งเมาส์ = ซูมเข้า/ออก
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [changeZoom]);

  return changeZoom;
}
