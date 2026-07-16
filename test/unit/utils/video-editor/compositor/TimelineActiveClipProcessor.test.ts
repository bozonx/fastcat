import { describe, it, expect, vi } from 'vitest';
import { TICKS_PER_MICROSECOND } from '~/utils/time';

import { TimelineActiveClipProcessor } from '~/utils/video-editor/compositor/TimelineActiveClipProcessor';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  const clip = {
    itemId: 'clip-1',
    clipKind: 'video',
    startTicks: 0,
    endTicks: 1_000_000,
    durationTicks: 1_000_000,
    sourceStartTicks: 0,
    sourceRangeDurationTicks: 1_000_000,
    sourceDurationTicks: 1_000_000,
    layer: 0,
    speed: 1,
    sprite: { visible: false, alpha: 1, blendMode: 'normal' } as any,
    sink: {} as any,
    ...overrides,
  };
  for (const field of [
    'startTicks',
    'endTicks',
    'durationTicks',
    'sourceStartTicks',
    'sourceRangeDurationTicks',
    'sourceDurationTicks',
    'freezeFrameSourceTicks',
  ] as const) {
    if (typeof clip[field] === 'number') clip[field] *= TICKS_PER_MICROSECOND;
  }
  return clip as unknown as CompositorClip;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  const params = {
    activeClips: [] as CompositorClip[],
    timeTicks: 0,
    width: 1920,
    height: 1080,
    syncTransitionFilter: vi.fn(),
    computeTransitionOpacity: vi.fn().mockReturnValue(1),
    drawHudClip: vi.fn(),
    drawShapeClip: vi.fn(),
    drawTextClip: vi.fn(),
    createPrimaryVideoSampleRequest: vi.fn().mockResolvedValue({ clip: null, sample: null }),
    ...overrides,
  };
  params.timeTicks = Number(params.timeTicks) * TICKS_PER_MICROSECOND;
  return params;
}

describe('TimelineActiveClipProcessor.process', () => {
  it('returns empty sampleRequests for no active clips', () => {
    const processor = new TimelineActiveClipProcessor();
    const result = processor.process(makeParams({ activeClips: [] }));
    expect(result.sampleRequests).toHaveLength(0);
  });

  it('makes visible and skips sample for image clips', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'image' });
    const params = makeParams({ activeClips: [clip] });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(0);
    expect(clip.sprite!.visible).toBe(true);
  });

  it('makes visible and skips sample for solid clips', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'solid' });
    const params = makeParams({ activeClips: [clip] });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(0);
    expect(clip.sprite!.visible).toBe(true);
  });

  it('makes visible and skips sample for adjustment clips', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'adjustment' });
    const params = makeParams({ activeClips: [clip] });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(0);
    expect(clip.sprite!.visible).toBe(true);
  });

  it('creates sample request for video clip within time range', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'video' });
    const createPrimaryVideoSampleRequest = vi.fn().mockResolvedValue({
      clip,
      sample: { close: vi.fn() },
    });
    const params = makeParams({
      activeClips: [clip],
      timeTicks: 500_000,
      createPrimaryVideoSampleRequest,
    });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(1);
    expect(createPrimaryVideoSampleRequest).toHaveBeenCalledWith(clip, expect.any(Number));
  });

  it('hides video clip when time is outside duration', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'video', durationTicks: 1_000_000 });
    const params = makeParams({ activeClips: [clip], timeTicks: 2_000_000 });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(0);
    expect(clip.sprite!.visible).toBe(false);
  });

  it('hides video clip when localTimeTicks < 0', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'video', startTicks: 500_000, durationTicks: 1_000_000 });
    const params = makeParams({ activeClips: [clip], timeTicks: 100_000 });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(0);
    expect(clip.sprite!.visible).toBe(false);
  });

  it('hides video clip when sink is missing', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'video', sink: undefined });
    const params = makeParams({ activeClips: [clip], timeTicks: 500_000 });
    const result = processor.process(params);
    expect(result.sampleRequests).toHaveLength(0);
    expect(clip.sprite!.visible).toBe(false);
  });

  it('uses freezeFrameSourceTicks when set', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'video', freezeFrameSourceTicks: 200_000 });
    const createPrimaryVideoSampleRequest = vi.fn().mockResolvedValue({
      clip,
      sample: { close: vi.fn() },
    });
    const params = makeParams({
      activeClips: [clip],
      timeTicks: 500_000,
      createPrimaryVideoSampleRequest,
    });
    processor.process(params);
    // sampleTimeS should be 200_000 / 1_000_000 = 0.2
    expect(createPrimaryVideoSampleRequest).toHaveBeenCalledWith(clip, 0.2);
  });

  it('draws shape clip when shapeDirty is true', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'shape', shapeDirty: true });
    const drawShapeClip = vi.fn();
    const params = makeParams({ activeClips: [clip], drawShapeClip });
    processor.process(params);
    expect(drawShapeClip).toHaveBeenCalled();
    expect(clip.shapeDirty).toBe(false);
    expect(clip.sprite!.visible).toBe(true);
  });

  it('does not redraw shape when shapeDirty is false', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'shape', shapeDirty: false });
    const drawShapeClip = vi.fn();
    const params = makeParams({ activeClips: [clip], drawShapeClip });
    processor.process(params);
    expect(drawShapeClip).not.toHaveBeenCalled();
  });

  it('draws text clip when textDirty is true and has text', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'text', text: 'Hello', textDirty: true });
    const drawTextClip = vi.fn();
    const params = makeParams({ activeClips: [clip], drawTextClip });
    processor.process(params);
    expect(drawTextClip).toHaveBeenCalled();
    expect(clip.textDirty).toBe(false);
    expect(clip.sprite!.visible).toBe(true);
  });

  it('draws text clip when the canvas has not been initialized yet', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({
      clipKind: 'text',
      text: 'Hello',
      textDirty: false,
      canvas: null,
      ctx: null,
    });
    const drawTextClip = vi.fn();
    const params = makeParams({ activeClips: [clip], drawTextClip });
    processor.process(params);
    expect(drawTextClip).toHaveBeenCalled();
    expect(clip.textDirty).toBe(false);
    expect(clip.sprite!.visible).toBe(true);
  });

  it('hides text clip when text is empty', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'text', text: '   ', textDirty: true });
    const drawTextClip = vi.fn();
    const params = makeParams({ activeClips: [clip], drawTextClip });
    processor.process(params);
    expect(drawTextClip).not.toHaveBeenCalled();
    expect(clip.sprite!.visible).toBe(false);
  });

  it('calls syncTransitionFilter and computeTransitionOpacity for each clip', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({ clipKind: 'image' });
    const syncTransitionFilter = vi.fn();
    const computeTransitionOpacity = vi.fn().mockReturnValue(0.8);
    const params = makeParams({
      activeClips: [clip],
      timeTicks: 100_000,
      syncTransitionFilter,
      computeTransitionOpacity,
    });
    processor.process(params);
    expect(syncTransitionFilter).toHaveBeenCalledWith(clip, 100_000 * TICKS_PER_MICROSECOND);
    expect(computeTransitionOpacity).toHaveBeenCalledWith(clip, 100_000 * TICKS_PER_MICROSECOND);
    expect(clip.sprite!.alpha).toBe(0.8);
  });

  it('creates mask sample request when mask is active video', () => {
    const processor = new TimelineActiveClipProcessor();
    const clip = makeClip({
      clipKind: 'video',
      maskActive: true,
      maskState: {
        clipKind: 'video',
        sink: {} as any,
        firstTimestampS: 0,
        frameRate: 30,
        lastVideoFrame: null,
      } as any,
    });
    const createPrimaryVideoSampleRequest = vi.fn().mockResolvedValue({
      clip,
      sample: { close: vi.fn(), toVideoFrame: vi.fn() },
    });
    const params = makeParams({
      activeClips: [clip],
      timeTicks: 500_000,
      createPrimaryVideoSampleRequest,
    });
    const result = processor.process(params);
    // One for the clip, one for the mask
    expect(result.sampleRequests).toHaveLength(2);
  });
});
