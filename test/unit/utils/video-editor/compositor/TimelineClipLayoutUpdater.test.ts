import { describe, expect, it, vi } from 'vitest';
import { TimelineClipLayoutUpdater } from '~/utils/video-editor/compositor/TimelineClipLayoutUpdater';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'c1',
    clipType: 'media',
    clipKind: 'video',
    sourceKind: 'videoFrame',
    layer: 0,
    startUs: 0,
    endUs: 5_000_000,
    durationUs: 5_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 5_000_000,
    sourceDurationUs: 10_000_000,
    sprite: null,
    imageSource: null as any,
    lastVideoFrame: null,
    canvas: null,
    ctx: null,
    bitmap: null,
    ...overrides,
  } as unknown as CompositorClip;
}

function makePayload(overrides: Record<string, unknown> = {}): any {
  return {
    kind: 'clip',
    id: 'c1',
    timelineRange: { startUs: 1_000_000, durationUs: 3_000_000 },
    sourceRange: { startUs: 500_000, durationUs: 3_000_000 },
    sourceDurationUs: 8_000_000,
    layer: 1,
    trackId: 'v2',
    ...overrides,
  };
}

function makeUpdater() {
  const applyLayout = vi.fn();
  const clearTransition = vi.fn();
  const toVideoEffects = vi.fn((v: unknown) => v as any);
  const updater = new TimelineClipLayoutUpdater();
  return { updater, applyLayout, clearTransition, toVideoEffects };
}

describe('TimelineClipLayoutUpdater', () => {
  it('rounds and clamps timeline range values', () => {
    const clip = makeClip();
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({
        timelineRange: { startUs: -100, durationUs: 3.7 },
      }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clip.startUs).toBe(0);
    expect(clip.durationUs).toBe(4);
    expect(clip.endUs).toBe(4);
  });

  it('rounds and clamps source range values', () => {
    const clip = makeClip();
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({
        sourceRange: { startUs: -50, durationUs: 2.9 },
      }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clip.sourceStartUs).toBe(0);
    expect(clip.sourceRangeDurationUs).toBe(3);
  });

  it('clamps speed to [-10, 10] and sets undefined for invalid values', () => {
    const clip = makeClip();
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ speed: 15 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.speed).toBe(10);

    updater.update({
      clip,
      next: makePayload({ speed: -20 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.speed).toBe(-10);

    updater.update({
      clip,
      next: makePayload({ speed: 0 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.speed).toBeUndefined();

    updater.update({
      clip,
      next: makePayload({ speed: NaN }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.speed).toBeUndefined();
  });

  it('clamps freezeFrameSourceUs to non-negative', () => {
    const clip = makeClip();
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ freezeFrameSourceUs: -500 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.freezeFrameSourceUs).toBe(0);

    updater.update({
      clip,
      next: makePayload({ freezeFrameSourceUs: 2_500_000 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.freezeFrameSourceUs).toBe(2_500_000);
  });

  it('sets freezeFrameSourceUs to undefined for non-finite values', () => {
    const clip = makeClip();
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ freezeFrameSourceUs: NaN }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.freezeFrameSourceUs).toBeUndefined();
  });

  it('uses fallback trackId when trackId is empty or missing', () => {
    const clip = makeClip();
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ trackId: '' }),
      fallbackTrackId: 'fallback-track',
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.trackId).toBe('fallback-track');

    updater.update({
      clip,
      next: makePayload({ trackId: 'real-track' }),
      fallbackTrackId: 'fallback-track',
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.trackId).toBe('real-track');
  });

  it('falls back to clip values when payload fields are missing', () => {
    const clip = makeClip({
      startUs: 2_000_000,
      durationUs: 4_000_000,
      sourceStartUs: 1_000_000,
      sourceRangeDurationUs: 3_000_000,
      sourceDurationUs: 6_000_000,
      layer: 3,
    });
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: { kind: 'clip', id: 'c1' } as any,
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clip.startUs).toBe(2_000_000);
    expect(clip.durationUs).toBe(4_000_000);
    expect(clip.sourceStartUs).toBe(1_000_000);
    expect(clip.sourceRangeDurationUs).toBe(3_000_000);
    expect(clip.sourceDurationUs).toBe(6_000_000);
    expect(clip.layer).toBe(3);
  });

  it('uses clip sourceDurationUs when payload value is not positive', () => {
    const clip = makeClip({ sourceDurationUs: 7_000_000 });
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ sourceDurationUs: 0 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.sourceDurationUs).toBe(7_000_000);

    updater.update({
      clip,
      next: makePayload({ sourceDurationUs: -100 }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    expect(clip.sourceDurationUs).toBe(7_000_000);
  });

  it('calls applyClipLayoutForCurrentSource and clearClipTransitionFilter on transition type change', () => {
    const clip = makeClip({ transitionIn: { type: 'fade', durationUs: 500_000 } as any });
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ transitionIn: { type: 'wipe', durationUs: 500_000 } }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clearTransition).toHaveBeenCalledTimes(1);
    expect(applyLayout).toHaveBeenCalledTimes(1);
  });

  it('does not call clearClipTransitionFilter when transition type is unchanged', () => {
    const clip = makeClip({ transitionIn: { type: 'fade', durationUs: 500_000 } as any });
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ transitionIn: { type: 'fade', durationUs: 1_000_000 } }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clearTransition).not.toHaveBeenCalled();
  });

  it('applies text layout after updating text and style', () => {
    const clip = makeClip({
      clipType: 'text',
      clipKind: 'text',
      text: 'Old',
      style: { fontSize: 40, lineHeight: 1 },
    });
    const { updater, clearTransition, toVideoEffects } = makeUpdater();
    const applyLayout = vi.fn((current: CompositorClip) => {
      expect(current.text).toBe('New\nNew');
      expect(current.style?.lineHeight).toBe(2);
    });

    updater.update({
      clip,
      next: makePayload({ text: 'New\nNew', style: { fontSize: 40, lineHeight: 2 } }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(applyLayout).toHaveBeenCalledTimes(1);
    expect(clip.textDirty).toBe(true);
  });

  it('keeps a text style snapshot so live payload mutations remain detectable', () => {
    const sourceStyle = { fontSize: 40, lineHeight: 1 };
    const clip = makeClip({
      clipType: 'text',
      clipKind: 'text',
      text: 'Text',
      style: { fontSize: 40, lineHeight: 1 },
      textDirty: false,
    });
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload({ text: 'Text', style: sourceStyle }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });
    clip.textDirty = false;
    sourceStyle.lineHeight = 2;

    updater.update({
      clip,
      next: makePayload({ text: 'Text', style: sourceStyle }),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clip.textDirty).toBe(true);
    expect(clip.style).not.toBe(sourceStyle);
  });

  it('initializes effectFilters map if missing', () => {
    const clip = makeClip();
    clip.effectFilters = undefined;
    const { updater, applyLayout, clearTransition, toVideoEffects } = makeUpdater();

    updater.update({
      clip,
      next: makePayload(),
      toVideoEffects,
      applyClipLayoutForCurrentSource: applyLayout,
      clearClipTransitionFilter: clearTransition,
    });

    expect(clip.effectFilters).toBeInstanceOf(Map);
  });
});
