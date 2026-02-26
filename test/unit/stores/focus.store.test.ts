import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFocusStore } from '../../../src/stores/focus.store';

describe('FocusStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('defaults to monitor main focus', () => {
    const store = useFocusStore();
    expect(store.mainFocus).toBe('monitor');
    expect(store.tempFocus).toBe('none');
    expect(store.effectiveFocus).toBe('monitor');
  });

  it('persists and restores main focus per timeline path', () => {
    const store = useFocusStore();

    store.setActiveTimelinePath('/a.otio');
    expect(store.mainFocus).toBe('monitor');

    store.setMainFocus('timeline');
    expect(store.mainFocus).toBe('timeline');

    store.setActiveTimelinePath('/b.otio');
    expect(store.mainFocus).toBe('monitor');

    store.setMainFocus('timeline');
    store.setActiveTimelinePath('/a.otio');
    expect(store.mainFocus).toBe('timeline');
  });

  it('focus hotkey toggles main focus when no temp focus', () => {
    const store = useFocusStore();

    store.handleFocusHotkey();
    expect(store.mainFocus).toBe('timeline');

    store.handleFocusHotkey();
    expect(store.mainFocus).toBe('monitor');
  });

  it('focus hotkey clears temp focus and does not toggle main focus', () => {
    const store = useFocusStore();

    store.setMainFocus('timeline');
    store.setTempFocus('left');

    store.handleFocusHotkey();

    expect(store.tempFocus).toBe('none');
    expect(store.mainFocus).toBe('timeline');
  });

  it('temporary left focus stays while file selection is active', () => {
    const store = useFocusStore();

    store.setMainFocus('timeline');
    store.setFileManagerSelectionActive(true);
    store.setTempFocus('left');

    expect(store.effectiveFocus).toBe('left');

    store.setFileManagerSelectionActive(false);

    expect(store.tempFocus).toBe('none');
    expect(store.effectiveFocus).toBe('timeline');
  });

  it('temporary right focus stays while right input focused', () => {
    const store = useFocusStore();

    store.setMainFocus('monitor');
    store.setRightInputFocused(true);
    store.setTempFocus('right');

    expect(store.effectiveFocus).toBe('right');

    store.setRightInputFocused(false);

    expect(store.tempFocus).toBe('none');
    expect(store.effectiveFocus).toBe('monitor');
  });

  it('hotkey permissions follow effective focus', () => {
    const store = useFocusStore();

    expect(store.canUsePlaybackHotkeys).toBe(true);
    expect(store.canUseTimelineHotkeys).toBe(false);

    store.setMainFocus('timeline');
    expect(store.canUsePlaybackHotkeys).toBe(false);
    expect(store.canUseTimelineHotkeys).toBe(true);

    store.setTempFocus('left');
    store.setFileManagerSelectionActive(true);
    expect(store.canUsePlaybackHotkeys).toBe(false);
    expect(store.canUseTimelineHotkeys).toBe(false);
  });
});
