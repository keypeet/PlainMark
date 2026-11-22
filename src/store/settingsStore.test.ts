import { beforeEach, describe, expect, it } from 'vitest';
import { clampFontSize, useSettingsStore } from './settingsStore';

describe('settingsStore V5 appearance', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAppearance();
  });

  it('has V5 defaults and clamps fontSize between 13 and 17', () => {
    const state = useSettingsStore.getState();
    expect(state.accentColor).toBe('indigo');
    expect(state.fontFamily).toBe('ibm-plex');
    expect(state.fontSize).toBe(15);
    expect(state.editorWidth).toBe('wide');

    expect(clampFontSize(10)).toBe(13);
    expect(clampFontSize(22)).toBe(17);

    state.setFontSize(16);
    expect(useSettingsStore.getState().fontSize).toBe(16);
  });

  it('updates and resets appearance presets', () => {
    const state = useSettingsStore.getState();
    state.setAccentColor('teal');
    state.setFontFamily('sarabun');
    state.setEditorWidth('narrow');
    state.setTheme('dark');

    expect(useSettingsStore.getState().accentColor).toBe('teal');
    expect(useSettingsStore.getState().fontFamily).toBe('sarabun');
    expect(useSettingsStore.getState().editorWidth).toBe('narrow');
    expect(useSettingsStore.getState().theme).toBe('dark');

    useSettingsStore.getState().resetAppearance();
    expect(useSettingsStore.getState().accentColor).toBe('indigo');
    expect(useSettingsStore.getState().fontFamily).toBe('ibm-plex');
    expect(useSettingsStore.getState().editorWidth).toBe('wide');
    expect(useSettingsStore.getState().theme).toBe('system');
  });
});
