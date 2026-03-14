import { describe, expect, it } from 'vitest';

import {
  canExecuteHotkeyCommand,
  createHotkeyLookup,
  getFocusAwareHotkeyOrder,
  getMatchedHotkeyCommands,
  getHotkeyCommandPolicy,
  isPreviewLikeFocus,
  shouldBlurAfterHotkey,
  shouldHandleRepeatForMatchedCommands,
} from '../../../src/utils/hotkeys/runtime';
import type { HotkeyCommandId } from '../../../src/utils/hotkeys/defaultHotkeys';

function createEffective(bindings: Partial<Record<HotkeyCommandId, string[]>>) {
  return bindings as Record<HotkeyCommandId, string[]>;
}

describe('hotkey runtime', () => {
  it('creates combo lookup preserving command order', () => {
    const lookup = createHotkeyLookup(
      createEffective({
        'general.focus': ['Tab'],
        'timeline.splitAtPlayhead': ['G', 'Space'],
        'playback.toggle': ['Space'],
      }),
      ['general.focus', 'timeline.splitAtPlayhead', 'playback.toggle'],
    );

    expect(lookup.Tab).toEqual(['general.focus']);
    expect(lookup.Space).toEqual(['timeline.splitAtPlayhead', 'playback.toggle']);
  });

  it('returns matched commands for known combo', () => {
    const lookup = createHotkeyLookup(
      createEffective({
        'general.focus': ['Tab'],
        'playback.toggle': ['Space'],
      }),
      ['general.focus', 'playback.toggle'],
    );

    expect(getMatchedHotkeyCommands({ combo: 'Space', lookup })).toEqual(['playback.toggle']);
    expect(getMatchedHotkeyCommands({ combo: 'Enter', lookup })).toEqual([]);
    expect(getMatchedHotkeyCommands({ combo: null, lookup })).toEqual([]);
  });

  it('orders matched commands based on active focus capabilities', () => {
    const matched: HotkeyCommandId[] = [
      'general.focus',
      'playback.toggle',
      'timeline.splitAtPlayhead',
    ];

    expect(
      getFocusAwareHotkeyOrder({
        matched,
        canUseTimelineHotkeys: true,
        canUsePlaybackHotkeys: false,
      }),
    ).toEqual(['timeline.splitAtPlayhead', 'general.focus', 'playback.toggle']);

    expect(
      getFocusAwareHotkeyOrder({
        matched,
        canUseTimelineHotkeys: false,
        canUsePlaybackHotkeys: true,
      }),
    ).toEqual(['playback.toggle', 'general.focus', 'timeline.splitAtPlayhead']);

    expect(
      getFocusAwareHotkeyOrder({
        matched,
        canUseTimelineHotkeys: false,
        canUsePlaybackHotkeys: false,
      }),
    ).toEqual(['general.focus', 'timeline.splitAtPlayhead', 'playback.toggle']);
  });

  it('blocks modal-only and editable-disallowed commands according to policy', () => {
    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.focus',
        hasBlockingModalState: true,
        isEditableEventTarget: false,
        isEditableActiveElement: false,
      }),
    ).toBe(false);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.fullscreen',
        hasBlockingModalState: true,
        isEditableEventTarget: false,
        isEditableActiveElement: false,
      }),
    ).toBe(true);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'timeline.splitAtPlayhead',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
      }),
    ).toBe(false);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.deselect',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: true,
      }),
    ).toBe(true);
  });

  it('uses policy to determine repeat and blur behavior', () => {
    expect(shouldHandleRepeatForMatchedCommands(['timeline.splitAtPlayhead'])).toBe(false);
    expect(getHotkeyCommandPolicy('general.fullscreen').allowWhenModalOpen).toBe(true);

    const button = document.createElement('button');
    expect(
      shouldBlurAfterHotkey({
        cmdId: 'general.focus',
        activeElement: button,
        isEditableTarget: () => false,
      }),
    ).toBe(false);
  });

  it('detects preview-like focus ids', () => {
    expect(isPreviewLikeFocus('project')).toBe(true);
    expect(isPreviewLikeFocus('left')).toBe(true);
    expect(isPreviewLikeFocus('dynamic:preview-1')).toBe(true);
    expect(isPreviewLikeFocus('timeline')).toBe(false);
  });
});
