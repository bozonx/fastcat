// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { TimelineLayoutOrchestrator } from '~/utils/video-editor/compositor/TimelineLayoutOrchestrator';

describe('TimelineLayoutOrchestrator', () => {
  it('updates and rebinds only clips that have matching timeline payload, then returns lifecycle result', () => {
    const orchestrator = new TimelineLayoutOrchestrator();
    const clipA = { itemId: 'clip-a' } as any;
    const clipB = { itemId: 'clip-b' } as any;
    const lifecycleResult = { clips: [clipA], maxDurationUs: 1_000 };

    const clipLayoutUpdater = {
      update: vi.fn(),
    } as any;
    const trackRebinder = {
      rebind: vi.fn(),
    } as any;
    const updateLifecycle = {
      apply: vi.fn(() => lifecycleResult),
    } as any;
    const getFallbackTrackId = vi.fn(({ next }) => `${next.id}-track`);
    const expectedTrackRuntime = {
      id: 'clip-a-runtime',
      layer: 0,
      container: { children: [] },
    } as any;
    const getTrackRuntimeForClip = vi.fn((clip) =>
      clip.itemId === 'clip-a' ? expectedTrackRuntime : null,
    ) as any;
    const toVideoEffects = vi.fn((value) => value as any);
    const applyClipLayoutForCurrentSource = vi.fn();
    const clearClipTransitionFilter = vi.fn();

    const result = orchestrator.apply({
      clips: [clipA, clipB],
      timelineClips: [
        { kind: 'meta', id: 'meta' },
        { kind: 'clip', id: 'clip-a', layer: 1 },
        { kind: 'clip', id: '', layer: 2 },
      ],
      clipLayoutUpdater,
      trackRebinder,
      updateLifecycle,
      getFallbackTrackId,
      getTrackRuntimeForClip,
      toVideoEffects,
      applyClipLayoutForCurrentSource,
      clearClipTransitionFilter,
    });

    expect(clipLayoutUpdater.update).toHaveBeenCalledTimes(1);
    expect(clipLayoutUpdater.update).toHaveBeenCalledWith({
      clip: clipA,
      next: { kind: 'clip', id: 'clip-a', layer: 1 },
      fallbackTrackId: 'clip-a-track',
      toVideoEffects,
      applyClipLayoutForCurrentSource,
      clearClipTransitionFilter,
    });
    expect(trackRebinder.rebind).toHaveBeenCalledTimes(1);
    expect(trackRebinder.rebind).toHaveBeenCalledWith({
      clip: clipA,
      trackRuntime: expectedTrackRuntime,
    });
    expect(updateLifecycle.apply).toHaveBeenCalledWith([clipA, clipB]);
    expect(result).toBe(lifecycleResult);
  });
});
