/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFocusStore } from '~/stores/focus.store';

describe('FocusStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('defaults to timeline main focus', () => {
    const store = useFocusStore();
    expect(store.mainFocus).toBe('timeline');
    expect(store.tempFocus).toBe('none');
    expect(store.activePanelId).toBe('timeline');
    expect(store.effectiveFocus).toBe('timeline');
  });

  it('persists and restores main focus per timeline path', () => {
    const store = useFocusStore();

    store.setActiveTimelinePath('/a.otio');
    expect(store.mainFocus).toBe('timeline');

    store.setMainFocus('monitor');
    expect(store.mainFocus).toBe('monitor');

    store.setActiveTimelinePath('/b.otio');
    expect(store.mainFocus).toBe('timeline');

    store.setMainFocus('timeline');
    store.setActiveTimelinePath('/a.otio');
    expect(store.mainFocus).toBe('monitor');
  });

  it('focus hotkey toggles main focus when main panel is active', () => {
    const store = useFocusStore();

    store.handleFocusHotkey();
    expect(store.mainFocus).toBe('monitor');
    expect(store.activePanelId).toBe('monitor');

    store.handleFocusHotkey();
    expect(store.mainFocus).toBe('timeline');
    expect(store.activePanelId).toBe('timeline');
  });

  it('focus hotkey restores last cut main panel from non-main panel', () => {
    const store = useFocusStore();

    store.setMainFocus('timeline');
    store.setPanelFocus('project');

    store.handleFocusHotkey();

    expect(store.activePanelId).toBe('timeline');
    expect(store.mainFocus).toBe('timeline');
  });

  it('legacy temporary left focus stays active', () => {
    const store = useFocusStore();

    store.setMainFocus('timeline');
    store.setTempFocus('left');

    expect(store.activePanelId).toBe('files-sidebar');
    expect(store.effectiveFocus).toBe('files-sidebar');
  });

  it('tracks last non-main panel and can restore it', () => {
    const store = useFocusStore();

    store.setPanelFocus('project');
    store.setPanelFocus('dynamic:media-1');

    expect(store.lastNonMainPanelId).toBe('dynamic:media-1');

    store.setMainFocus('timeline');
    const restored = store.restoreLastNonMainPanel();

    expect(restored).toBe(true);
    expect(store.activePanelId).toBe('dynamic:media-1');
  });

  it('hotkey permissions follow effective focus categories', () => {
    const store = useFocusStore();

    expect(store.canUsePlaybackHotkeys).toBe(true);
    expect(store.canUseTimelineHotkeys).toBe(true);
    expect(store.canUsePreviewHotkeys).toBe(false);

    store.setMainFocus('timeline');
    expect(store.canUsePlaybackHotkeys).toBe(true);
    expect(store.canUseTimelineHotkeys).toBe(true);
    expect(store.canUsePreviewHotkeys).toBe(false);

    store.setPanelFocus('project');
    expect(store.canUsePlaybackHotkeys).toBe(true);
    expect(store.canUseTimelineHotkeys).toBe(false);
    expect(store.canUsePreviewHotkeys).toBe(true);
    expect(store.isPropertiesFocus).toBe(false);

    store.setPanelFocus('dynamic:properties:files-main');
    expect(store.canUseTimelineHotkeys).toBe(false);
    expect(store.canUsePreviewHotkeys).toBe(true);
    expect(store.isPropertiesFocus).toBe(true);

    store.setPanelFocus('dynamic:file-manager:detached-files');
    expect(store.canUsePlaybackHotkeys).toBe(true);
    expect(store.canUseTimelineHotkeys).toBe(false);
    expect(store.canUsePreviewHotkeys).toBe(true);

    store.setPanelFocus('dynamic:detached-preview');
    expect(store.canUsePlaybackHotkeys).toBe(true);
    expect(store.canUseTimelineHotkeys).toBe(false);
    expect(store.canUsePreviewHotkeys).toBe(false);
  });

  it('clearTempFocus restores last cut main panel only for legacy temp panels', () => {
    const store = useFocusStore();

    store.setMainFocus('timeline');
    store.setTempFocus('right');
    store.clearTempFocus();

    expect(store.activePanelId).toBe('timeline');
    expect(store.tempFocus).toBe('none');
  });

  it('restores saved main focus when timeline path changes while main panel is active', () => {
    const store = useFocusStore();

    store.setActiveTimelinePath('/first.otio');
    store.setMainFocus('monitor');
    store.setActiveTimelinePath('/second.otio');

    expect(store.activePanelId).toBe('timeline');
    expect(store.mainFocus).toBe('timeline');

    store.setMainFocus('timeline');
    store.setActiveTimelinePath('/first.otio');

    expect(store.activePanelId).toBe('monitor');
    expect(store.mainFocus).toBe('monitor');
  });
});
