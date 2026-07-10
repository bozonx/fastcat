import { describe, it, expect, vi } from 'vitest';
import {
  findVideoPassthroughCandidate,
  buildPassthroughVideoTrack,
  writeVideoPassthrough,
} from '~/workers/core/export-video-passthrough';
import type { WorkerVideoPayloadItem } from '~/types/worker-payload';

const DURATION_US = 10_000_000;

function baseOptions() {
  return {
    videoCodec: 'avc1.64001f',
    format: 'mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 5_000_000,
  };
}

function baseClip(overrides: Record<string, unknown> = {}): WorkerVideoPayloadItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    layer: 0,
    source: { path: '/video.mp4' },
    timelineRange: { startUs: 0, durationUs: DURATION_US },
    sourceRange: { startUs: 0, durationUs: DURATION_US },
    sourceDurationUs: DURATION_US,
    ...overrides,
  } as unknown as WorkerVideoPayloadItem;
}

function candidate(
  clips: WorkerVideoPayloadItem[],
  optionOverrides: Record<string, unknown> = {},
  maxDurationUs = DURATION_US,
) {
  return findVideoPassthroughCandidate({
    timelineClips: clips,
    options: { ...baseOptions(), ...optionOverrides },
    maxDurationUs,
  });
}

describe('findVideoPassthroughCandidate', () => {
  it('accepts a single untouched full-coverage media clip', () => {
    const result = candidate([baseClip()]);
    expect(result.ok).toBe(true);
  });

  it('accepts disabled effects and audio-only effects', () => {
    const result = candidate([
      baseClip({
        effects: [
          { target: 'video', enabled: false },
          { target: 'audio', enabled: true },
        ],
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  const rejections: Array<[string, () => ReturnType<typeof candidate>]> = [
    ['disabled by option', () => candidate([baseClip()], { videoPassthrough: false })],
    ['video disabled', () => candidate([baseClip()], { videoCodec: 'none' })],
    ['alpha export', () => candidate([baseClip()], { exportAlpha: true })],
    [
      'timeline has master effects',
      () =>
        candidate([{ kind: 'meta', masterEffects: [{ type: 'brightness' }] } as never, baseClip()]),
    ],
    [
      'a track has effects',
      () =>
        candidate([
          { kind: 'track', id: 't1', layer: 0, effects: [{ type: 'blur' }] } as never,
          baseClip(),
        ]),
    ],
    ['timeline has 2 visible clips', () => candidate([baseClip(), baseClip({ id: 'clip-2' })])],
    ['timeline has 0 visible clips', () => candidate([])],
    ['the clip is not a media file', () => candidate([baseClip({ clipType: 'text' })])],
    ['clip speed is not 1', () => candidate([baseClip({ speed: 2 })])],
    ['clip is a freeze frame', () => candidate([baseClip({ freezeFrameSourceUs: 0 })])],
    ['clip has non-unit opacity', () => candidate([baseClip({ opacity: 0.5 })])],
    ['clip has a blend mode', () => candidate([baseClip({ blendMode: 'multiply' })])],
    [
      'clip has video effects',
      () => candidate([baseClip({ effects: [{ target: 'video', enabled: true }] })]),
    ],
    ['clip has a mask', () => candidate([baseClip({ mask: { shape: 'circle' } })])],
    ['clip has a transform/crop', () => candidate([baseClip({ transform: { scale: 1.5 } })])],
    [
      'clip has a transform/crop (crop)',
      () => candidate([baseClip({ transform: { crop: { left: 0.1 } } })]),
    ],
    [
      'clip has keyframe animations',
      () => candidate([baseClip({ animations: { opacity: [{ timeUs: 0, value: 1 }] } })]),
    ],
    [
      'clip has transitions',
      () => candidate([baseClip({ transitionIn: { type: 'crossfade', durationUs: 1000 } })]),
    ],
    [
      'clip does not start at timeline zero',
      () =>
        candidate([baseClip({ timelineRange: { startUs: 1_000_000, durationUs: DURATION_US } })]),
    ],
    [
      'clip does not cover the whole export',
      () => candidate([baseClip()], {}, DURATION_US + 2_000_000),
    ],
    [
      'clip head is trimmed',
      () =>
        candidate([
          baseClip({ sourceRange: { startUs: 500_000, durationUs: DURATION_US - 500_000 } }),
        ]),
    ],
    [
      'clip tail is trimmed',
      () =>
        candidate([baseClip({ sourceRange: { startUs: 0, durationUs: DURATION_US - 2_000_000 } })]),
    ],
  ];

  for (const [name, run] of rejections) {
    it(`rejects: ${name}`, () => {
      const result = run();
      expect(result.ok).toBe(false);
    });
  }

  it('tolerates a sub-frame tail difference (source-duration rounding)', () => {
    const result = candidate([
      baseClip({ sourceRange: { startUs: 0, durationUs: DURATION_US - 20_000 } }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('accepts an identity transform object', () => {
    const result = candidate([
      baseClip({
        transform: {
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
        },
      }),
    ]);
    expect(result.ok).toBe(true);
  });
});

function makeOpenInput(trackOverrides: Record<string, unknown> = {}) {
  const dispose = vi.fn();
  const addedPackets: unknown[] = [];
  const videoSource = {
    add: vi.fn(async (packet: unknown) => {
      addedPackets.push(packet);
    }),
  };
  const track = {
    codec: 'avc',
    displayWidth: 1920,
    displayHeight: 1080,
    rotation: 0,
    getDecoderConfig: vi.fn().mockResolvedValue({ codec: 'avc1.64001f' }),
    computePacketStats: vi
      .fn()
      .mockResolvedValue({ averagePacketRate: 30, averageBitrate: 4_000_000 }),
    computeDuration: vi.fn().mockResolvedValue(10),
    ...trackOverrides,
  };
  const openInput = vi.fn(async () => ({
    input: { marker: 'input' },
    videoTrack: track as never,
    makePacketSink: () => ({
      packets: async function* () {
        yield { timestamp: 0, duration: 5, type: 'key' };
        yield { timestamp: 5, duration: 5, type: 'delta' };
      },
    }),
    makeVideoSource: () => videoSource,
    dispose,
  }));
  return { openInput, dispose, videoSource, addedPackets, track };
}

function buildParams(openInputBundle: ReturnType<typeof makeOpenInput>) {
  const clipResult = findVideoPassthroughCandidate({
    timelineClips: [baseClip()],
    options: baseOptions(),
    maxDurationUs: DURATION_US,
  });
  if (!clipResult.ok) throw new Error('fixture clip must be eligible');
  return {
    clip: clipResult.clip,
    options: baseOptions(),
    hostClient: {
      getFileHandleByPath: vi.fn().mockResolvedValue({} as FileSystemFileHandle),
    },
    getFile: vi.fn().mockResolvedValue({} as File),
    openInput: openInputBundle.openInput,
  };
}

describe('buildPassthroughVideoTrack', () => {
  it('builds a state for a matching source', async () => {
    const bundle = makeOpenInput();
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    expect(state).not.toBeNull();
    expect(state!.durationS).toBe(10);
    expect(bundle.dispose).not.toHaveBeenCalled();
  });

  const sourceRejections: Array<[string, Record<string, unknown>]> = [
    ['codec mismatch', { codec: 'hevc' }],
    ['rotation', { rotation: 90 }],
    ['resolution mismatch', { displayWidth: 1280, displayHeight: 720 }],
    [
      'fps mismatch',
      {
        computePacketStats: vi
          .fn()
          .mockResolvedValue({ averagePacketRate: 25, averageBitrate: 4_000_000 }),
      },
    ],
    [
      'source bitrate exceeds requested',
      {
        computePacketStats: vi
          .fn()
          .mockResolvedValue({ averagePacketRate: 30, averageBitrate: 20_000_000 }),
      },
    ],
    ['missing decoder config', { getDecoderConfig: vi.fn().mockResolvedValue(null) }],
  ];

  for (const [name, overrides] of sourceRejections) {
    it(`falls back (null) on ${name} and disposes the input`, async () => {
      const bundle = makeOpenInput(overrides);
      const state = await buildPassthroughVideoTrack(buildParams(bundle));
      expect(state).toBeNull();
      expect(bundle.dispose).toHaveBeenCalledTimes(1);
    });
  }

  it('falls back when the source has no video track', async () => {
    const bundle = makeOpenInput();
    const openInput = vi.fn(async () => ({
      ...(await bundle.openInput()),
      videoTrack: null,
    }));
    const params = { ...buildParams(bundle), openInput };
    const state = await buildPassthroughVideoTrack(params);
    expect(state).toBeNull();
  });
});

describe('writeVideoPassthrough', () => {
  it('copies all packets, attaches decoderConfig on the first, reports progress and disposes', async () => {
    const bundle = makeOpenInput();
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    expect(state).not.toBeNull();

    const disposeInput = vi.fn();
    const progress: number[] = [];
    await writeVideoPassthrough({
      state: state!,
      ensureNotCancelled: () => {},
      onProgress: (p) => progress.push(p),
      disposeInput,
    });

    expect(bundle.videoSource.add).toHaveBeenCalledTimes(2);
    const firstCall = bundle.videoSource.add.mock.calls[0]!;
    expect(firstCall[1]).toEqual({ decoderConfig: { codec: 'avc1.64001f' } });
    const secondCall = bundle.videoSource.add.mock.calls[1]!;
    expect(secondCall[1]).toBeUndefined();
    expect(progress.at(-1)).toBe(1);
    expect(disposeInput).toHaveBeenCalledWith(state!.input);
  });

  it('disposes the input even when cancelled mid-stream', async () => {
    const bundle = makeOpenInput();
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    const disposeInput = vi.fn();
    let calls = 0;
    await expect(
      writeVideoPassthrough({
        state: state!,
        ensureNotCancelled: () => {
          calls += 1;
          if (calls > 1) throw new Error('cancelled');
        },
        disposeInput,
      }),
    ).rejects.toThrow('cancelled');
    expect(disposeInput).toHaveBeenCalledTimes(1);
  });
});
