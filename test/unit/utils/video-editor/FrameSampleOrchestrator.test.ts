/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { FrameSampleOrchestrator } from '~/utils/video-editor/compositor/FrameSampleOrchestrator';
import {
  clampToLastReadableSourceUs,
  TimelineActiveClipProcessor,
} from '~/utils/video-editor/compositor/TimelineActiveClipProcessor';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeOrchestrator() {
  return new FrameSampleOrchestrator();
}

function makeProcessor() {
  return new TimelineActiveClipProcessor();
}

interface ShadowSampleScenarioOptions {
  prevSpeed: number;
  localTimeUs: number;
  prevSourceStartUs?: number;
  prevSourceRangeDurationUs?: number;
  prevSourceDurationUs?: number;
  prevFrameRate?: number;
}

async function collectShadowSampleTimesS(options: ShadowSampleScenarioOptions): Promise<number[]> {
  const calls: number[] = [];
  const orchestrator = makeOrchestrator();
  const processor = makeProcessor();
  const getVideoSampleForClip = vi.fn(async (req: { sampleTimeS: number }) => {
    calls.push(req.sampleTimeS);
    return null;
  });

  const transitionDurationUs = 500_000;
  const prevClip = {
    itemId: 'prev',
    sprite: { alpha: 1, blendMode: 'normal', visible: true },
    clipKind: 'video',
    startUs: 0,
    durationUs: 1_000_000,
    sourceStartUs: options.prevSourceStartUs ?? 2_000_000,
    sourceRangeDurationUs: options.prevSourceRangeDurationUs ?? 1_000_000,
    sourceDurationUs: options.prevSourceDurationUs ?? 10_000_000,
    speed: options.prevSpeed,
    frameRate: options.prevFrameRate,
    sink: {},
  } as unknown as CompositorClip;

  const nextClip = {
    itemId: 'next',
    sprite: { alpha: 1, blendMode: 'normal', visible: true },
    clipKind: 'video',
    startUs: 1_000_000,
    durationUs: 1_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 1_000_000,
    sourceDurationUs: 5_000_000,
    speed: 1,
    transitionIn: {
      durationUs: transitionDurationUs,
      mode: 'adjacent',
      type: 'fade',
    },
    sink: {},
  } as unknown as CompositorClip;

  await orchestrator.process({
    activeClips: [nextClip],
    timeUs: nextClip.startUs + options.localTimeUs,
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
    getPrevClipOnLayer: (clip) => (clip === nextClip ? prevClip : null),
    updateClipTextureFromSample: vi.fn().mockResolvedValue(undefined),
    setClipSpriteVisible: () => true,
  });

  return calls;
}

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

  it('clamps forward clip sampling to the readable end of its source range', async () => {
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
      itemId: 'forward',
      sprite: { alpha: 1, blendMode: 'normal', visible: true },
      clipKind: 'video',
      startUs: 0,
      durationUs: 1_000_001,
      sourceStartUs: 2_000_000,
      sourceRangeDurationUs: 1_000_000,
      speed: 1,
      frameRate: 30,
      sink: {},
    } as unknown as CompositorClip;

    await orchestrator.process({
      activeClips: [clip],
      timeUs: 1_000_000,
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
      expect.objectContaining({ sampleTimeS: 2.983333 }),
    );
  });
});

describe('FrameSampleOrchestrator shadow sampling during adjacent transition', () => {
  it('maps timeline delta to source delta via |speed| for forward prev clip', async () => {
    const localTimeUs = 200_000;
    const prevSpeed = 2;
    const calls = await collectShadowSampleTimesS({
      prevSpeed,
      localTimeUs,
    });

    // Two requests: shadow for prev (overrun beyond sourceRangeEnd) + primary
    // for next clip. We only assert the shadow request — primary is part of
    // the next clip's flow and tested elsewhere.
    const expectedSampleUs = 2_000_000 + 1_000_000 + Math.round(localTimeUs * prevSpeed); // 3_400_000
    expect(calls).toContain(expectedSampleUs / 1_000_000);
  });

  it('honours |speed| < 1 (slow-motion) by reducing the shadow source delta', async () => {
    const localTimeUs = 400_000;
    const prevSpeed = 0.5;
    const calls = await collectShadowSampleTimesS({
      prevSpeed,
      localTimeUs,
    });

    const expectedSampleUs = 3_000_000 + Math.round(localTimeUs * prevSpeed); // 3_200_000
    expect(calls).toContain(expectedSampleUs / 1_000_000);
  });

  it('reverses the shadow direction for negative-speed prev clip', async () => {
    const localTimeUs = 250_000;
    const prevSpeed = -2;
    const calls = await collectShadowSampleTimesS({
      prevSpeed,
      localTimeUs,
      // Leading handle 2s, trailing handle 7s; reversed consumes the leading.
      prevSourceStartUs: 2_000_000,
      prevSourceRangeDurationUs: 1_000_000,
      prevSourceDurationUs: 10_000_000,
    });

    const expectedSampleUs = 2_000_000 - Math.round(localTimeUs * Math.abs(prevSpeed)); // 1_500_000
    expect(calls).toContain(expectedSampleUs / 1_000_000);
  });

  it('clamps the shadow sample to the last readable source frame', async () => {
    // Trailing handle is tiny (50ms), well below the 1ms guard threshold for
    // the small-handle path, so the orchestrator must fall back to the last
    // readable frame rather than overshooting into undecodable territory.
    const frameRate = 24;
    const calls = await collectShadowSampleTimesS({
      prevSpeed: 4,
      localTimeUs: 250_000,
      prevSourceStartUs: 0,
      prevSourceRangeDurationUs: 1_000_000,
      prevSourceDurationUs: 5_000_000,
      prevFrameRate: frameRate,
    });

    const lastReadableUs = clampToLastReadableSourceUs(5_000_000, frameRate);
    // 4× speed × 250ms = 1s past sourceRangeEnd → would land at 2s; the
    // sample must instead be clamped to lastReadableUs (~4.979s).
    const candidate = (1_000_000 + Math.round(250_000 * 4)) / 1_000_000;
    expect(candidate).toBeGreaterThan(0);
    expect(calls).toContain(Math.min(candidate, lastReadableUs / 1_000_000));
    // Sanity: the actual call should not exceed the last readable frame.
    for (const sampleS of calls) {
      expect(sampleS).toBeLessThanOrEqual(lastReadableUs / 1_000_000);
    }
  });

  it('falls back to the last frame within the used range when the trailing handle is empty', async () => {
    // No trailing handle (rangeEnd === sourceDuration), so the orchestrator
    // should pin the shadow to the last readable frame within the used range.
    const frameRate = 30;
    const calls = await collectShadowSampleTimesS({
      prevSpeed: 1,
      localTimeUs: 200_000,
      prevSourceStartUs: 0,
      prevSourceRangeDurationUs: 5_000_000,
      prevSourceDurationUs: 5_000_000,
      prevFrameRate: frameRate,
    });

    const lastReadableUs = clampToLastReadableSourceUs(5_000_000, frameRate);
    // The "small handle" path uses (sourceRangeEnd - 1ms) but clamped to the
    // last readable source position; with frameRate=30 the half-frame guard
    // is larger than 1ms so we use the lastReadableUs path.
    const sampleUs = Math.max(0, Math.min(lastReadableUs, 5_000_000 - 1_000));
    expect(calls).toContain(sampleUs / 1_000_000);
  });
});
