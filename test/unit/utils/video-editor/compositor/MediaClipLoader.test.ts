import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TICKS_PER_MICROSECOND } from '~/utils/time';
import { MediaClipLoader } from '~/utils/video-editor/compositor/MediaClipLoader';
import type {
  MediaClipLoaderMediabunny,
  MediabunnyTrack,
} from '~/utils/video-editor/compositor/MediaClipLoader';

function makeTrack(overrides: Partial<MediabunnyTrack> = {}): MediabunnyTrack {
  return {
    canDecode: async () => true,
    getFirstTimestamp: async () => 0,
    computeDuration: async () => 10,
    getFrameRate: async () => 30,
    rotation: 0,
    ...overrides,
  };
}

function makeMediabunny(track: MediabunnyTrack | null): MediaClipLoaderMediabunny {
  class MockBlobSource {
    constructor(_file: unknown) {}
  }
  class MockInput {
    getPrimaryVideoTrack = vi.fn().mockResolvedValue(track);
  }
  class MockVideoSampleSink {
    constructor(_track: unknown) {}
  }
  return {
    Input: MockInput as unknown as MediaClipLoaderMediabunny['Input'],
    BlobSource: MockBlobSource as unknown as MediaClipLoaderMediabunny['BlobSource'],
    VideoSampleSink: MockVideoSampleSink as unknown as MediaClipLoaderMediabunny['VideoSampleSink'],
    ALL_FORMATS: {},
  };
}

describe('MediaClipLoader', () => {
  let loader: MediaClipLoader;

  beforeEach(() => {
    loader = new MediaClipLoader();
    const loadVideoRuntime = loader.loadVideoRuntime.bind(loader);
    vi.spyOn(loader, 'loadVideoRuntime').mockImplementation((options) =>
      loadVideoRuntime({
        ...options,
        startUs: options.startUs * TICKS_PER_MICROSECOND,
        sourceStartUs: options.sourceStartUs * TICKS_PER_MICROSECOND,
        requestedTimelineDurationUs: options.requestedTimelineDurationUs * TICKS_PER_MICROSECOND,
        requestedSourceDurationUs: options.requestedSourceDurationUs * TICKS_PER_MICROSECOND,
        requestedSourceRangeDurationUs:
          options.requestedSourceRangeDurationUs * TICKS_PER_MICROSECOND,
      }),
    );
  });

  it('computes sourceDurationUs as min(requested, full media duration)', async () => {
    const track = makeTrack({ computeDuration: async () => 10 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 2_000_000,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 5_000_000,
      requestedSourceRangeDurationUs: 0,
      startUs: 1_000_000,
    });

    expect(result).not.toBeNull();
    // mediaDurationUs = 10 * 1_000_000 = 10_000_000
    // sourceDurationUs = min(5_000_000, 10_000_000) = 5_000_000
    expect(result!.sourceDurationUs).toBe(5_000_000 * TICKS_PER_MICROSECOND);
  });

  it('keeps the FULL media duration for a clip trimmed at its start', async () => {
    // Regression: sourceDurationUs is an ABSOLUTE source-domain value — the full
    // media duration. Transition handle math downstream computes
    // `sourceDurationUs - sourceStartUs - sourceRangeDurationUs`, and the
    // reuse/layout-update paths store the payload's full-duration value as-is.
    // The loader used to clamp by the tail (media - sourceStart), double-counting
    // sourceStartUs: a 60s file trimmed to start at 10s reported 50s, so a
    // transition's trailing handle came out 10s short (frozen shadow frames).
    const track = makeTrack({ computeDuration: async () => 10 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 2_000_000,
      requestedTimelineDurationUs: 4_000_000,
      requestedSourceDurationUs: 10_000_000,
      requestedSourceRangeDurationUs: 4_000_000,
      startUs: 0,
    });

    expect(result).not.toBeNull();
    expect(result!.sourceDurationUs).toBe(10_000_000 * TICKS_PER_MICROSECOND);
    // Trailing handle available past the source range: 10 - 2 - 4 = 4s.
    expect(
      result!.sourceDurationUs - 2_000_000 * TICKS_PER_MICROSECOND - result!.sourceRangeDurationUs,
    ).toBe(4_000_000 * TICKS_PER_MICROSECOND);
  });

  it('uses the full media duration when requestedSourceDurationUs is 0', async () => {
    const track = makeTrack({ computeDuration: async () => 8 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 3_000_000,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result).not.toBeNull();
    // mediaDurationUs = 8_000_000 (absolute, NOT reduced by sourceStartUs)
    expect(result!.sourceDurationUs).toBe(8_000_000 * TICKS_PER_MICROSECOND);
    // The timeline-duration fallback, by contrast, is the playable tail.
    expect(result!.durationUs).toBe(5_000_000 * TICKS_PER_MICROSECOND);
  });

  it('uses requestedTimelineDurationUs when > 0, else sourceDurationUs', async () => {
    const track = makeTrack({ computeDuration: async () => 10 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 3_000_000,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 1_000_000,
    });

    expect(result).not.toBeNull();
    expect(result!.durationUs).toBe(3_000_000 * TICKS_PER_MICROSECOND);
    expect(result!.endUs).toBe(4_000_000 * TICKS_PER_MICROSECOND);
  });

  it('falls back to the playable source tail for durationUs when timelineDuration is 0', async () => {
    const track = makeTrack({ computeDuration: async () => 6 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 2_000_000,
    });

    expect(result).not.toBeNull();
    // sourceDurationUs = 6_000_000, durationUs = 6_000_000
    expect(result!.durationUs).toBe(6_000_000 * TICKS_PER_MICROSECOND);
    expect(result!.endUs).toBe(8_000_000 * TICKS_PER_MICROSECOND);
  });

  it('uses requestedSourceRangeDurationUs when > 0, else durationUs', async () => {
    const track = makeTrack({ computeDuration: async () => 10 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 4_000_000,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 2_000_000,
      startUs: 0,
    });

    expect(result).not.toBeNull();
    expect(result!.sourceRangeDurationUs).toBe(2_000_000 * TICKS_PER_MICROSECOND);
  });

  it('returns null when track is null', async () => {
    const mediabunny = makeMediabunny(null);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result).toBeNull();
  });

  it('returns null when track cannot decode', async () => {
    const track = makeTrack({ canDecode: async () => false });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result).toBeNull();
  });

  it('throws AbortError when abortSignal is already aborted', async () => {
    const track = makeTrack();
    const mediabunny = makeMediabunny(track);
    const controller = new AbortController();
    controller.abort();

    await expect(
      loader.loadVideoRuntime({
        mediabunny,
        file: new File([], 'test.mp4'),
        sourceStartUs: 0,
        requestedTimelineDurationUs: 0,
        requestedSourceDurationUs: 0,
        requestedSourceRangeDurationUs: 0,
        startUs: 0,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow('Video runtime load was aborted');
  });

  it('returns frameRate when valid and positive', async () => {
    const track = makeTrack({ getFrameRate: async () => 60 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result!.frameRate).toBe(60);
  });

  it('returns undefined frameRate when invalid', async () => {
    const track = makeTrack({ getFrameRate: async () => NaN });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result!.frameRate).toBeUndefined();
  });

  it('reads frameRate from frameRate property when getFrameRate is missing', async () => {
    const track = makeTrack({ getFrameRate: undefined, frameRate: 24 } as any);
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result!.frameRate).toBe(24);
  });

  // --- frame-rate fallback via packet stats (low-fps web playback regression) ---
  //
  // mediabunny's InputVideoTrack exposes no direct frame-rate accessor. When
  // getFrameRate/frameRate/fps are all absent, the loader must estimate the rate
  // from `computePacketStats().averagePacketRate`. If it does NOT, every clip loads
  // with frameRate: undefined, computeFrameIndex falls back to exact-tick cache keys,
  // the frame cache/prewarm never produce a cross-timestamp hit, and playback pays a
  // cold from-keyframe decode per displayed frame (the ~½-fps web monitor bug).
  it('derives frameRate from computePacketStats().averagePacketRate when no rate accessor exists', async () => {
    const computePacketStats = vi.fn().mockResolvedValue({ averagePacketRate: 29.97 });
    const track = makeTrack({
      getFrameRate: undefined,
      frameRate: undefined,
      fps: undefined,
      computePacketStats,
    } as unknown as Partial<MediabunnyTrack>);
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(computePacketStats).toHaveBeenCalledWith(60);
    expect(result!.frameRate).toBeCloseTo(29.97, 5);
  });

  it('does NOT reach for packet stats when a valid frame rate is already known', async () => {
    const computePacketStats = vi.fn().mockResolvedValue({ averagePacketRate: 29.97 });
    const track = makeTrack({
      getFrameRate: async () => 25,
      computePacketStats,
    } as unknown as Partial<MediabunnyTrack>);
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(computePacketStats).not.toHaveBeenCalled();
    expect(result!.frameRate).toBe(25);
  });

  it('falls back to the packet-stats estimate when the rate accessor yields a non-positive value', async () => {
    const computePacketStats = vi.fn().mockResolvedValue({ averagePacketRate: 24 });
    const track = makeTrack({
      getFrameRate: async () => 0,
      computePacketStats,
    } as unknown as Partial<MediabunnyTrack>);
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(computePacketStats).toHaveBeenCalledWith(60);
    expect(result!.frameRate).toBe(24);
  });

  it('keeps frameRate undefined (graceful) when packet-stats estimation throws', async () => {
    const computePacketStats = vi.fn().mockRejectedValue(new Error('no packets'));
    const track = makeTrack({
      getFrameRate: undefined,
      frameRate: undefined,
      fps: undefined,
      computePacketStats,
    } as unknown as Partial<MediabunnyTrack>);
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 0,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    // Exact-tick cache keying still works for repeat renders — just no cross-timestamp reuse.
    expect(computePacketStats).toHaveBeenCalled();
    expect(result!.frameRate).toBeUndefined();
  });

  it('clamps the timeline-duration fallback to 0 when sourceStartUs exceeds mediaDuration', async () => {
    const track = makeTrack({ computeDuration: async () => 5 });
    const mediabunny = makeMediabunny(track);

    const result = await loader.loadVideoRuntime({
      mediabunny,
      file: new File([], 'test.mp4'),
      sourceStartUs: 6_000_000,
      requestedTimelineDurationUs: 0,
      requestedSourceDurationUs: 0,
      requestedSourceRangeDurationUs: 0,
      startUs: 0,
    });

    expect(result).not.toBeNull();
    // sourceDurationUs stays the absolute media duration...
    expect(result!.sourceDurationUs).toBe(5_000_000 * TICKS_PER_MICROSECOND);
    // ...while the playable tail past the trim-in point is empty.
    expect(result!.durationUs).toBe(0);
  });
});
