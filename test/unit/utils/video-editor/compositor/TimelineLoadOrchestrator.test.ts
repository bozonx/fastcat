import { describe, it, expect, vi } from 'vitest';

import { TimelineLoadOrchestrator } from '~/utils/video-editor/compositor/TimelineLoadOrchestrator';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    timelineClipLoader: {
      describe: vi.fn().mockReturnValue(null),
      isReusableClipMatch: vi.fn().mockReturnValue(false),
      updateReusableClip: vi.fn(),
    },
    timelineClipAssetLoader: {
      build: vi.fn(),
      initializeHudMediaStates: vi.fn().mockResolvedValue(undefined),
      initializeMaskState: vi.fn().mockResolvedValue(undefined),
    },
    clipFactory: {
      createImageClip: vi.fn(),
      createVideoClip: vi.fn(),
    },
    layoutApplier: {
      applySpriteLayout: vi.fn(),
    },
    mediaClipLoader: {
      loadVideoRuntime: vi.fn().mockResolvedValue(null),
    },
    rasterImageLoader: {
      load: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function makeCallbacks(overrides: Record<string, unknown> = {}) {
  return {
    destroyClip: vi.fn(),
    getExistingClipById: vi.fn().mockReturnValue(undefined),
    getFallbackTrackId: vi.fn().mockReturnValue('track_0'),
    getTrackRuntimeForClip: vi.fn().mockReturnValue(null),
    applySolidLayout: vi.fn(),
    replaceExistingClip: vi.fn(),
    resolveFixedClipEnd: vi
      .fn()
      .mockReturnValue({ endTicks: 1_000_000, sequentialTimeTicks: 1_000_000 }),
    registerLoadedClip: vi.fn(
      ({
        clip,
        nextClips,
        nextClipById,
      }: {
        clip: CompositorClip;
        nextClips: CompositorClip[];
        nextClipById: Map<string, CompositorClip>;
      }) => {
        nextClips.push(clip);
        nextClipById.set(clip.itemId, clip);
      },
    ),
    toVideoEffects: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    getFileHandleByPath: vi.fn().mockResolvedValue(null),
    getFileByPath: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('TimelineLoadOrchestrator.load', () => {
  it('returns empty result for empty timeline', async () => {
    const orchestrator = new TimelineLoadOrchestrator(makeContext());
    const result = await orchestrator.load({
      timelineClips: [],
      deps: makeDeps() as any,
      mediabunny: {} as any,
      callbacks: makeCallbacks() as any,
    });
    expect(result.nextClips).toHaveLength(0);
    expect(result.nextClipById.size).toBe(0);
    expect(result.sequentialTimeTicks).toBe(0);
  });

  it('skips clips when descriptor is null', async () => {
    const context = makeContext();
    const orchestrator = new TimelineLoadOrchestrator(context);
    const result = await orchestrator.load({
      timelineClips: [{ kind: 'clip', layer: 0 }] as any,
      deps: makeDeps() as any,
      mediabunny: {} as any,
      callbacks: makeCallbacks() as any,
    });
    expect(context.timelineClipLoader.describe).toHaveBeenCalled();
    expect(result.nextClips).toHaveLength(0);
  });

  it('throws AbortError when checkCancel returns true', async () => {
    const orchestrator = new TimelineLoadOrchestrator(makeContext());
    const callbacks = makeCallbacks({ checkCancel: vi.fn().mockReturnValue(true) });
    await expect(
      orchestrator.load({
        timelineClips: [{ kind: 'clip', layer: 0 }] as any,
        deps: makeDeps() as any,
        mediabunny: {} as any,
        callbacks: callbacks as any,
      }),
    ).rejects.toThrow('Export was cancelled during timeline load');
  });

  it('destroys loaded clips on cancel', async () => {
    const context = makeContext({
      timelineClipLoader: {
        describe: vi.fn().mockReturnValue({
          clipType: 'background',
          itemId: 'bg1',
          sourcePath: undefined,
          sourceStartTicks: 0,
          freezeFrameSourceTicks: undefined,
          layer: 0,
          trackId: 'track_0',
          requestedTimelineDurationTicks: 1_000_000,
          requestedSourceRangeDurationTicks: 1_000_000,
          requestedSourceDurationTicks: 1_000_000,
          speed: 1,
          startTicks: 0,
          endUsFallback: 1_000_000,
        }),
        isReusableClipMatch: vi.fn().mockReturnValue(false),
        updateReusableClip: vi.fn(),
      },
      timelineClipAssetLoader: {
        build: vi.fn().mockReturnValue({ itemId: 'bg1', clipKind: 'solid' } as any),
        initializeHudMediaStates: vi.fn(),
        initializeMaskState: vi.fn(),
      },
    });
    const orchestrator = new TimelineLoadOrchestrator(context);
    const mockClip = { itemId: 'bg1' } as CompositorClip;
    const callbacks = makeCallbacks({
      checkCancel: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      destroyClip: vi.fn(),
      getExistingClipById: vi.fn().mockReturnValue(undefined),
      registerLoadedClip: vi.fn(
        ({
          clip,
          nextClips,
          nextClipById,
        }: {
          clip: CompositorClip;
          nextClips: CompositorClip[];
          nextClipById: Map<string, CompositorClip>;
        }) => {
          nextClips.push(clip);
          nextClipById.set(clip.itemId, clip);
        },
      ),
    });
    await expect(
      orchestrator.load({
        timelineClips: [
          { kind: 'clip', layer: 0 },
          { kind: 'clip', layer: 0 },
        ] as any,
        deps: makeDeps() as any,
        mediabunny: {} as any,
        callbacks: callbacks as any,
      }),
    ).rejects.toThrow('Export was cancelled during timeline load');
  });
});

describe('TimelineLoadOrchestrator.processDescriptor — fixed clips', () => {
  it('builds background clip via timelineClipAssetLoader', async () => {
    const mockClip = { itemId: 'bg1', clipKind: 'solid' } as CompositorClip;
    const context = makeContext({
      timelineClipLoader: {
        describe: vi.fn().mockReturnValue({
          clipType: 'background',
          itemId: 'bg1',
          sourcePath: undefined,
          sourceStartTicks: 0,
          freezeFrameSourceTicks: undefined,
          layer: 0,
          trackId: 'track_0',
          requestedTimelineDurationTicks: 5_000_000,
          requestedSourceRangeDurationTicks: 5_000_000,
          requestedSourceDurationTicks: 5_000_000,
          speed: 1,
          startTicks: 0,
          endUsFallback: 5_000_000,
        }),
        isReusableClipMatch: vi.fn().mockReturnValue(false),
        updateReusableClip: vi.fn(),
      },
      timelineClipAssetLoader: {
        build: vi.fn().mockReturnValue(mockClip),
        initializeHudMediaStates: vi.fn(),
        initializeMaskState: vi.fn(),
      },
    });
    const orchestrator = new TimelineLoadOrchestrator(context);
    const callbacks = makeCallbacks();
    const result = await orchestrator.load({
      timelineClips: [{ kind: 'clip', layer: 0 }] as any,
      deps: makeDeps() as any,
      mediabunny: {} as any,
      callbacks: callbacks as any,
    });
    expect(context.timelineClipAssetLoader.build).toHaveBeenCalled();
    expect(callbacks.registerLoadedClip).toHaveBeenCalled();
    expect(result.nextClips).toContain(mockClip);
  });

  it('initializes HUD media states for hud clips', async () => {
    const mockClip = { itemId: 'hud1', clipKind: 'hud' } as CompositorClip;
    const context = makeContext({
      timelineClipLoader: {
        describe: vi.fn().mockReturnValue({
          clipType: 'hud',
          itemId: 'hud1',
          sourcePath: undefined,
          sourceStartTicks: 0,
          freezeFrameSourceTicks: undefined,
          layer: 0,
          trackId: 'track_0',
          requestedTimelineDurationTicks: 5_000_000,
          requestedSourceRangeDurationTicks: 5_000_000,
          requestedSourceDurationTicks: 5_000_000,
          speed: 1,
          startTicks: 0,
          endUsFallback: 5_000_000,
        }),
        isReusableClipMatch: vi.fn().mockReturnValue(false),
        updateReusableClip: vi.fn(),
      },
      timelineClipAssetLoader: {
        build: vi.fn().mockReturnValue(mockClip),
        initializeHudMediaStates: vi.fn().mockResolvedValue(undefined),
        initializeMaskState: vi.fn().mockResolvedValue(undefined),
      },
    });
    const orchestrator = new TimelineLoadOrchestrator(context);
    await orchestrator.load({
      timelineClips: [{ kind: 'clip', layer: 0 }] as any,
      deps: makeDeps() as any,
      mediabunny: {} as any,
      callbacks: makeCallbacks() as any,
    });
    expect(context.timelineClipAssetLoader.initializeHudMediaStates).toHaveBeenCalled();
  });

  it('initializes mask state when descriptor has maskPath', async () => {
    const mockClip = { itemId: 'bg1', clipKind: 'solid' } as CompositorClip;
    const context = makeContext({
      timelineClipLoader: {
        describe: vi.fn().mockReturnValue({
          clipType: 'background',
          itemId: 'bg1',
          sourcePath: undefined,
          sourceStartTicks: 0,
          freezeFrameSourceTicks: undefined,
          layer: 0,
          trackId: 'track_0',
          requestedTimelineDurationTicks: 5_000_000,
          requestedSourceRangeDurationTicks: 5_000_000,
          requestedSourceDurationTicks: 5_000_000,
          speed: 1,
          startTicks: 0,
          endUsFallback: 5_000_000,
          maskPath: '/mask.png',
        }),
        isReusableClipMatch: vi.fn().mockReturnValue(false),
        updateReusableClip: vi.fn(),
      },
      timelineClipAssetLoader: {
        build: vi.fn().mockReturnValue(mockClip),
        initializeHudMediaStates: vi.fn(),
        initializeMaskState: vi.fn().mockResolvedValue(undefined),
      },
    });
    const orchestrator = new TimelineLoadOrchestrator(context);
    await orchestrator.load({
      timelineClips: [{ kind: 'clip', layer: 0 }] as any,
      deps: makeDeps() as any,
      mediabunny: {} as any,
      callbacks: makeCallbacks() as any,
    });
    expect(context.timelineClipAssetLoader.initializeMaskState).toHaveBeenCalled();
  });
});

describe('TimelineLoadOrchestrator.processDescriptor — media clips', () => {
  it('returns early when sourcePath is missing', async () => {
    const context = makeContext({
      timelineClipLoader: {
        describe: vi.fn().mockReturnValue({
          clipType: 'media',
          itemId: 'clip1',
          sourcePath: undefined,
          sourceStartTicks: 0,
          freezeFrameSourceTicks: undefined,
          layer: 0,
          trackId: 'track_0',
          requestedTimelineDurationTicks: 1_000_000,
          requestedSourceRangeDurationTicks: 1_000_000,
          requestedSourceDurationTicks: 1_000_000,
          speed: 1,
          startTicks: 0,
          endUsFallback: 1_000_000,
        }),
        isReusableClipMatch: vi.fn().mockReturnValue(false),
        updateReusableClip: vi.fn(),
      },
    });
    const orchestrator = new TimelineLoadOrchestrator(context);
    const result = await orchestrator.load({
      timelineClips: [{ kind: 'clip', layer: 0 }] as any,
      deps: makeDeps() as any,
      mediabunny: {} as any,
      callbacks: makeCallbacks() as any,
    });
    expect(result.nextClips).toHaveLength(0);
  });

  it('returns early when file handle is not found', async () => {
    const context = makeContext({
      timelineClipLoader: {
        describe: vi.fn().mockReturnValue({
          clipType: 'media',
          itemId: 'clip1',
          sourcePath: '/video.mp4',
          sourceStartTicks: 0,
          freezeFrameSourceTicks: undefined,
          layer: 0,
          trackId: 'track_0',
          requestedTimelineDurationTicks: 1_000_000,
          requestedSourceRangeDurationTicks: 1_000_000,
          requestedSourceDurationTicks: 1_000_000,
          speed: 1,
          startTicks: 0,
          endUsFallback: 1_000_000,
        }),
        isReusableClipMatch: vi.fn().mockReturnValue(false),
        updateReusableClip: vi.fn(),
      },
    });
    const orchestrator = new TimelineLoadOrchestrator(context);
    const result = await orchestrator.load({
      timelineClips: [{ kind: 'clip', layer: 0 }] as any,
      deps: makeDeps({ getFileHandleByPath: vi.fn().mockResolvedValue(null) }) as any,
      mediabunny: {} as any,
      callbacks: makeCallbacks() as any,
    });
    expect(result.nextClips).toHaveLength(0);
  });
});
