// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  getHotkeyCommandPolicy,
  createHotkeyLookup,
  createDefaultHotkeyLookup,
  getFocusAwareHotkeyOrder,
  canExecuteHotkeyCommand,
  shouldHandleRepeatForMatchedCommands,
  shouldBlurAfterHotkey,
  getMatchedHotkeyCommands,
  isPreviewLikeFocus,
} from '~/utils/hotkeys/runtime';

vi.mock('~/utils/hotkeys/defaultHotkeys', () => ({
  DEFAULT_HOTKEYS: {
    commands: [
      { id: 'play', groupId: 'general', label: 'Play' },
      { id: 'pause', groupId: 'general', label: 'Pause' },
    ],
    bindings: {
      play: ['Space'],
      pause: ['Enter'],
    },
  },
}));

describe('getHotkeyCommandPolicy', () => {
  it('returns default policy for unknown command', () => {
    const policy = getHotkeyCommandPolicy('unknown' as any);
    expect(policy.allowInEditable).toBe(false);
    expect(policy.allowWhenModalOpen).toBe(false);
    expect(policy.repeatable).toBe(false);
  });

  it('returns merged policy for known commands', () => {
    const policy = getHotkeyCommandPolicy('general.zoomIn');
    expect(policy.allowWhenModalOpen).toBe(true);
    expect(policy.repeatable).toBe(true);
    expect(policy.allowInEditable).toBe(false);
  });
});

describe('createHotkeyLookup', () => {
  it('creates lookup from effective bindings', () => {
    const effective = {
      play: ['Space'],
      pause: ['Space'],
    };
    const lookup = createHotkeyLookup(effective, ['play', 'pause']);
    expect(lookup['Space']).toEqual(['play', 'pause']);
  });

  it('respects filter function', () => {
    const effective = {
      play: ['Space'],
      pause: ['Enter'],
    };
    const lookup = createHotkeyLookup(effective, ['play', 'pause'], (id) => id === 'play');
    expect(lookup['Space']).toEqual(['play']);
    expect(lookup['Enter']).toBeUndefined();
  });
});

describe('createDefaultHotkeyLookup', () => {
  it('creates lookup from default bindings', () => {
    const lookup = createDefaultHotkeyLookup(['play', 'pause']);
    expect(lookup['Space']).toEqual(['play']);
    expect(lookup['Enter']).toEqual(['pause']);
  });
});

describe('getFocusAwareHotkeyOrder', () => {
  it('prioritizes file manager local commands when file manager hotkeys are available', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: [
        'playback.backward5',
        'general.navigateBack',
        'timeline.rippleDeleteSelectedClipRange',
      ],
      canUseFileManagerHotkeys: true,
      canUseTimelineHotkeys: false,
      canUsePlaybackHotkeys: true,
    });
    expect(result).toEqual([
      'general.navigateBack',
      'playback.backward5',
      'timeline.rippleDeleteSelectedClipRange',
    ]);
  });

  it('prioritizes timeline when can use timeline hotkeys', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: ['general.play', 'timeline.cut', 'playback.stop', 'general.navigateBack'],
      canUseTimelineHotkeys: true,
      canUsePlaybackHotkeys: false,
    });
    expect(result).toEqual([
      'timeline.cut',
      'playback.stop',
      'general.play',
      'general.navigateBack',
    ]);
  });

  it('prioritizes playback when can use playback hotkeys', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: ['general.play', 'timeline.cut', 'playback.stop'],
      canUseTimelineHotkeys: false,
      canUsePlaybackHotkeys: true,
    });
    expect(result).toEqual(['playback.stop', 'general.play', 'timeline.cut']);
  });

  it('defaults to playback > general > timeline', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: ['general.play', 'timeline.cut', 'playback.stop'],
      canUseTimelineHotkeys: false,
      canUsePlaybackHotkeys: false,
    });
    expect(result).toEqual(['playback.stop', 'general.play', 'timeline.cut']);
  });
});

describe('canExecuteHotkeyCommand', () => {
  it('blocks commands when modal is open', () => {
    expect(
      canExecuteHotkeyCommand({
        cmdId: 'play',
        hasBlockingModalState: true,
        isEditableEventTarget: false,
        isEditableActiveElement: false,
      }),
    ).toBe(false);
  });

  it('allows commands that allowWhenModalOpen', () => {
    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.zoomIn',
        hasBlockingModalState: true,
        isEditableEventTarget: false,
        isEditableActiveElement: false,
      }),
    ).toBe(true);
  });

  it('blocks commands in editable by default', () => {
    expect(
      canExecuteHotkeyCommand({
        cmdId: 'play',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
      }),
    ).toBe(false);
  });

  it('allows commands in editable when policy permits', () => {
    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.deselect',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
      }),
    ).toBe(true);
  });

  it('allows save/mute/volume in editable only with Ctrl combo', () => {
    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.save',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
        pressedCombo: 'Ctrl+S',
      }),
    ).toBe(true);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.save',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
        pressedCombo: 'Shift+S',
      }),
    ).toBe(false);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.mute',
        hasBlockingModalState: false,
        isEditableEventTarget: false,
        isEditableActiveElement: true,
        pressedCombo: 'Ctrl+Q',
      }),
    ).toBe(true);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.volumeUp',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
        pressedCombo: 'R',
      }),
    ).toBe(false);

    expect(
      canExecuteHotkeyCommand({
        cmdId: 'general.volumeDown',
        hasBlockingModalState: false,
        isEditableEventTarget: true,
        isEditableActiveElement: false,
        pressedCombo: 'Ctrl+E',
      }),
    ).toBe(true);
  });
});

describe('shouldHandleRepeatForMatchedCommands', () => {
  it('returns true if any command is repeatable', () => {
    expect(shouldHandleRepeatForMatchedCommands(['general.zoomIn', 'play'])).toBe(true);
  });

  it('returns false if no command is repeatable', () => {
    expect(shouldHandleRepeatForMatchedCommands(['play', 'pause'])).toBe(false);
  });
});

describe('shouldBlurAfterHotkey', () => {
  it('returns true for blur policy with HTMLElement', () => {
    const el = document.createElement('input');
    expect(shouldBlurAfterHotkey({ cmdId: 'general.deselect', activeElement: el })).toBe(true);
  });

  it('returns false for non-blur policy', () => {
    expect(shouldBlurAfterHotkey({ cmdId: 'play', activeElement: null })).toBe(false);
  });
});

describe('getMatchedHotkeyCommands', () => {
  it('returns matched commands for combo', () => {
    const lookup = { Space: ['play', 'pause'] } as any;
    expect(getMatchedHotkeyCommands({ combo: 'Space', lookup })).toEqual(['play', 'pause']);
  });

  it('returns empty array for null combo', () => {
    expect(getMatchedHotkeyCommands({ combo: null, lookup: {} as any })).toEqual([]);
  });
});

describe('isPreviewLikeFocus', () => {
  it('returns true for preview-like focus IDs', () => {
    expect(isPreviewLikeFocus('left')).toBe(true);
    expect(isPreviewLikeFocus('project')).toBe(true);
    expect(isPreviewLikeFocus('filesBrowser')).toBe(true);
  });

  it('returns true for dynamic preview-like focus IDs', () => {
    expect(isPreviewLikeFocus('dynamic:media')).toBe(true);
    expect(isPreviewLikeFocus('dynamic:library')).toBe(true);
  });

  it('returns false for non-preview-like focus IDs', () => {
    expect(isPreviewLikeFocus('timeline')).toBe(false);
    expect(isPreviewLikeFocus('dynamic:unknown')).toBe(false);
  });
});
