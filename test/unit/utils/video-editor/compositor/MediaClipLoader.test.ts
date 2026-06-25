import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MediaClipLoader } from '~/utils/video-editor/compositor/MediaClipLoader';
import type { MediaClipLoaderMediabunny, MediabunnyTrack } from '~/utils/video-editor/compositor/MediaClipLoader';

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
  });

  it('computes sourceDurationUs as min(requested, maxTail)', async () => {
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
    // maxSourceTailUs = 10_000_000 - 2_000_000 = 8_000_000
    // sourceDurationUs = min(5_000_000, 8_000_000) = 5_000_000
    expect(result!.sourceDurationUs).toBe(5_000_000);
  });

  it('uses maxTail when requestedSourceDurationUs is 0', async () => {
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
    // mediaDurationUs = 8_000_000, maxTail = 5_000_000
    expect(result!.sourceDurationUs).toBe(5_000_000);
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
    expect(result!.durationUs).toBe(3_000_000);
    expect(result!.endUs).toBe(4_000_000);
  });

  it('falls back to sourceDurationUs for durationUs when timelineDuration is 0', async () => {
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
    expect(result!.durationUs).toBe(6_000_000);
    expect(result!.endUs).toBe(8_000_000);
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
    expect(result!.sourceRangeDurationUs).toBe(2_000_000);
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

  it('clamps maxSourceTailUs to 0 when sourceStartUs exceeds mediaDuration', async () => {
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
    // mediaDurationUs = 5_000_000, maxSourceTailUs = max(0, 5_000_000 - 6_000_000) = 0
    expect(result!.sourceDurationUs).toBe(0);
    expect(result!.durationUs).toBe(0);
  });
});
