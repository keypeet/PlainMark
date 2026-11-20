import { useCallback, useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';

// ซูมเนื้อหา Editor แบบลื่นด้วย CSS custom property (--editor-zoom) — ไม่พึ่ง Tauri webview API
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

  useEffect(() => {
    document.documentElement.style.setProperty('--editor-zoom', String(zoom));
  }, [zoom]);

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
