/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { FrameSampleOrchestrator } from '~/utils/video-editor/compositor/FrameSampleOrchestrator';
import { TimelineActiveClipProcessor } from '~/utils/video-editor/compositor/TimelineActiveClipProcessor';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

describe('FrameSampleOrchestrator', () => {
  it('calls applyClipEffects after samples so mask/video state is ready', async () => {
    const orchestrator = new FrameSampleOrchestrator();
    const processor = new TimelineActiveClipProcessor();

    const applyClipEffects = vi.fn();
    const clip = {
      itemId: 'c1',
      sprite: { alpha: 1, blendMode: 'normal', visible: true },
      clipKind: 'video',
      startUs: 0,
      durationUs: 1_000_000,
      sink: {},
    } as unknown as CompositorClip;

    await orchestrator.process({
      activeClips: [clip],
      timeUs: 0,
      width: 1920,
      height: 1080,
      activeClipProcessor: processor,
      syncTransitionFilter: vi.fn(),
      computeTransitionOpacity: () => 1,
      applyClipEffects,
      drawHudClip: vi.fn(),
      drawShapeClip: vi.fn(),
      drawTextClip: vi.fn(),
      createAbortController: () => new AbortController(),
      getVideoSampleForClip: vi.fn().mockResolvedValue({
        toVideoFrame: () => ({
          displayWidth: 2,
          displayHeight: 2,
          close: () => {},
        }),
      }),
      getPrevClipOnLayer: () => null,
      updateClipTextureFromSample: vi.fn().mockResolvedValue(undefined),
      setClipSpriteVisible: () => true,
    });

    expect(applyClipEffects).toHaveBeenCalled();
    const lastCall = applyClipEffects.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(clip);
  });

  it('samples reversed clips inside the readable source range', async () => {
    const orchestrator = new FrameSampleOrchestrator();
    const processor = new TimelineActiveClipProcessor();
    const getVideoSampleForClip = vi.fn().mockResolvedValue({
      toVideoFrame: () => ({
        displayWidth: 2,
        displayHeight: 2,
        close: () => {},
      }),
    });
    const clip = {
      itemId: 'reverse',
      sprite: { alpha: 1, blendMode: 'normal', visible: true },
      clipKind: 'video',
      startUs: 0,
      durationUs: 1_000_000,
      sourceStartUs: 2_000_000,
      sourceRangeDurationUs: 1_000_000,
      speed: -1,
      sink: {},
    } as unknown as CompositorClip;

    await orchestrator.process({
      activeClips: [clip],
      timeUs: 0,
      width: 1920,
      height: 1080,
      activeClipProcessor: processor,
      syncTransitionFilter: vi.fn(),
      computeTransitionOpacity: () => 1,
      applyClipEffects: vi.fn(),
      drawHudClip: vi.fn(),
      drawShapeClip: vi.fn(),
      drawTextClip: vi.fn(),
      createAbortController: () => new AbortController(),
      getVideoSampleForClip,
      getPrevClipOnLayer: () => null,
      updateClipTextureFromSample: vi.fn().mockResolvedValue(undefined),
      setClipSpriteVisible: () => true,
    });

    expect(getVideoSampleForClip).toHaveBeenCalledWith(
      expect.objectContaining({ sampleTimeS: 2.999 }),
    );
  });
});
