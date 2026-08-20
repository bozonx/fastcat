// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getFocusAwareHotkeyOrder } from '~/utils/hotkeys/runtime';

describe('getFocusAwareHotkeyOrder with default commands', () => {
  it('routes Z to file manager local action and filters inactive local panels', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: [
        'general.navigateBack',
        'timeline.rippleDeleteSelectedClipRange',
        'playback.backward5',
      ],
      canUseFileManagerHotkeys: true,
      canUseTimelineHotkeys: false,
      canUseMonitorHotkeys: false,
    });

    expect(result).toEqual(['general.navigateBack']);
  });

  it('does not run timeline or monitor local shortcuts while file manager is focused', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: ['timeline.splitAtPlayhead', 'playback.forward5'],
      canUseFileManagerHotkeys: true,
      canUseTimelineHotkeys: false,
      canUseMonitorHotkeys: false,
    });

    expect(result).toEqual([]);
  });

  it('keeps global playback shortcuts available while file manager is focused', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: ['playback.toggle'],
      canUseFileManagerHotkeys: true,
      canUseTimelineHotkeys: false,
      canUseMonitorHotkeys: false,
    });

    expect(result).toEqual(['playback.toggle']);
  });

  it('routes local duplicates to the active timeline panel before global commands', () => {
    const result = getFocusAwareHotkeyOrder({
      matched: ['timeline.splitAtPlayhead', 'playback.forward5', 'playback.toggle'],
      canUseFileManagerHotkeys: false,
      canUseTimelineHotkeys: true,
      canUseMonitorHotkeys: false,
    });

    expect(result).toEqual(['timeline.splitAtPlayhead', 'playback.toggle']);
  });
});
