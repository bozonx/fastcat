import { describe, it, expect, vi } from 'vitest';
import {
  computePayloadVideoEndTicks,
  findLastNeededPacketIndex,
  findVideoPassthroughCandidate,
  buildPassthroughVideoTrack,
  writeVideoPassthrough,
  isSourceFrameIntervalUniform,
  type PassthroughPacketSink,
} from '~/workers/core/export-video-passthrough';
import type { WorkerVideoPayloadItem } from '~/types/worker-payload';

const DURATION_TICKS = 2_540_160_000_000;

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
    timelineRange: { startTicks: 0, durationTicks: DURATION_TICKS },
    sourceRange: { startTicks: 0, durationTicks: DURATION_TICKS },
    sourceDurationTicks: DURATION_TICKS,
    ...overrides,
  } as unknown as WorkerVideoPayloadItem;
}

function candidate(
  clips: WorkerVideoPayloadItem[],
  optionOverrides: Record<string, unknown> = {},
  maxDurationTicks = DURATION_TICKS,
) {
  return findVideoPassthroughCandidate({
    timelineClips: clips,
    options: { ...baseOptions(), ...optionOverrides },
    maxDurationTicks,
  });
}

describe('computePayloadVideoEndTicks', () => {
  it('returns the max timeline end across clip items only', () => {
    const end = computePayloadVideoEndTicks([
      { kind: 'meta', masterEffects: [] } as never,
      { kind: 'track', id: 't', layer: 0 } as never,
      baseClip({
        timelineRange: {
          startTicks: 254_016_000_000,
          durationTicks: 762_048_000_000,
        },
      }),
      baseClip({
        id: 'c2',
        timelineRange: { startTicks: 0, durationTicks: 508_032_000_000 },
      }),
    ]);
    expect(end).toBe(1_016_064_000_000);
  });

  it('returns 0 for an empty payload', () => {
    expect(computePayloadVideoEndTicks([])).toBe(0);
  });
});

describe('findVideoPassthroughCandidate', () => {
  it('accepts a single untouched full-coverage media clip', () => {
    const result = candidate([baseClip()]);
    expect(result.ok).toBe(true);
  });

  it('accepts a head-trimmed clip (keyframe alignment is checked later)', () => {
    const result = candidate(
      [
        baseClip({
          timelineRange: { startTicks: 0, durationTicks: 2_032_128_000_000 },
          sourceRange: {
            startTicks: 508_032_000_000,
            durationTicks: 2_032_128_000_000,
          },
        }),
      ],
      {},
      2_032_128_000_000,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a tail-trimmed clip', () => {
    const result = candidate(
      [
        baseClip({
          timelineRange: { startTicks: 0, durationTicks: 1_524_096_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 1_524_096_000_000 },
        }),
      ],
      {},
      1_524_096_000_000,
    );
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
    ['clip is a freeze frame', () => candidate([baseClip({ freezeFrameSourceTicks: 0 })])],
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
      () => candidate([baseClip({ animations: { opacity: [{ timeTicks: 0, value: 1 }] } })]),
    ],
    [
      'clip has transitions',
      () => candidate([baseClip({ transitionIn: { type: 'crossfade', durationTicks: 1000 } })]),
    ],
    [
      'clip does not start at timeline zero',
      () =>
        candidate([
          baseClip({
            timelineRange: { startTicks: 254_016_000_000, durationTicks: DURATION_TICKS },
          }),
        ]),
    ],
    [
      'clip does not cover the whole export',
      () => candidate([baseClip()], {}, DURATION_TICKS + 508_032_000_000),
    ],
    [
      'timeline and source windows disagree (stretch would be needed)',
      () =>
        candidate([
          baseClip({
            sourceRange: {
              startTicks: 0,
              durationTicks: DURATION_TICKS - 508_032_000_000,
            },
          }),
        ]),
    ],
    [
      'empty source range',
      () =>
        candidate(
          [
            baseClip({
              timelineRange: { startTicks: 0, durationTicks: 0 },
              sourceRange: { startTicks: 0, durationTicks: 0 },
            }),
          ],
          {},
          0,
        ),
    ],
  ];

  for (const [name, run] of rejections) {
    it(`rejects: ${name}`, () => {
      const result = run();
      expect(result.ok).toBe(false);
    });
  }

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

interface MockPacket {
  timestamp: number;
  duration: number;
  type: 'key' | 'delta';
  clone: (options: { timestamp: number }) => unknown;
}

function makePacket(timestamp: number, type: 'key' | 'delta', duration = 1 / 30): MockPacket {
  const packet: MockPacket = {
    timestamp,
    duration,
    type,
    clone: (options) => ({ ...packet, timestamp: options.timestamp, cloned: true }),
  };
  return packet;
}

/** Default stream: keyframes every 5s over 10s at "1 packet per 5s" scale. */
function defaultPackets(): MockPacket[] {
  return [makePacket(0, 'key', 5), makePacket(5, 'delta', 5)];
}

function makeSink(packets: MockPacket[]): PassthroughPacketSink {
  return {
    getKeyPacket: vi.fn(async (timestampS: number) => {
      let best: MockPacket | null = null;
      for (const p of packets) {
        if (p.type === 'key' && p.timestamp <= timestampS) {
          if (!best || p.timestamp > best.timestamp) best = p;
        }
      }
      return best;
    }),
    packets: vi.fn(async function* (startPacket?: unknown) {
      const startIndex = startPacket ? packets.indexOf(startPacket as MockPacket) : 0;
      for (const p of packets.slice(Math.max(0, startIndex))) {
        yield p;
      }
    }),
  } as unknown as PassthroughPacketSink;
}

function makeOpenInput(
  trackOverrides: Record<string, unknown> = {},
  packets: MockPacket[] = defaultPackets(),
) {
  const dispose = vi.fn();
  const videoSource = { add: vi.fn(async () => {}) };
  const sink = makeSink(packets);
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
    makePacketSink: () => sink,
    makeVideoSource: () => videoSource,
    dispose,
  }));
  return { openInput, dispose, videoSource, track, sink };
}

function buildParams(
  openInputBundle: ReturnType<typeof makeOpenInput>,
  clipOverrides: Record<string, unknown> = {},
  maxDurationTicks = DURATION_TICKS,
) {
  const clipResult = findVideoPassthroughCandidate({
    timelineClips: [baseClip(clipOverrides)],
    options: baseOptions(),
    maxDurationTicks,
  });
  if (!clipResult.ok) throw new Error(`fixture clip must be eligible: ${clipResult.reason}`);
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
  it('builds a whole-stream state for an untrimmed source', async () => {
    const bundle = makeOpenInput();
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    expect(state).not.toBeNull();
    expect(state!.copyStartS).toBe(0);
    expect(state!.copyEndS).toBe(10);
    expect(state!.wholeStream).toBe(true);
    expect(bundle.dispose).not.toHaveBeenCalled();
  });

  it('accepts a keyframe-aligned head trim and shifts the copy window', async () => {
    const packets = [makePacket(0, 'key', 2), makePacket(2, 'key', 4), makePacket(6, 'delta', 4)];
    const bundle = makeOpenInput({}, packets);
    const state = await buildPassthroughVideoTrack(
      buildParams(
        bundle,
        {
          timelineRange: { startTicks: 0, durationTicks: 2_032_128_000_000 },
          sourceRange: {
            startTicks: 508_032_000_000,
            durationTicks: 2_032_128_000_000,
          },
        },
        2_032_128_000_000,
      ),
    );
    expect(state).not.toBeNull();
    expect(state!.copyStartS).toBe(2);
    expect(state!.copyEndS).toBe(10);
    expect(state!.wholeStream).toBe(true);
    expect(state!.startPacket).toBe(packets[1]);
  });

  it('rejects a head trim that is not keyframe-aligned', async () => {
    // Keyframes at 0 and 5; trim at 2s → nearest key 0, misaligned.
    const packets = [makePacket(0, 'key', 5), makePacket(5, 'key', 5)];
    const bundle = makeOpenInput({}, packets);
    const state = await buildPassthroughVideoTrack(
      buildParams(
        bundle,
        {
          timelineRange: { startTicks: 0, durationTicks: 2_032_128_000_000 },
          sourceRange: {
            startTicks: 508_032_000_000,
            durationTicks: 2_032_128_000_000,
          },
        },
        2_032_128_000_000,
      ),
    );
    expect(state).toBeNull();
    expect(bundle.dispose).toHaveBeenCalledTimes(1);
  });

  it('marks a tail-trimmed copy as not whole-stream', async () => {
    const bundle = makeOpenInput();
    const state = await buildPassthroughVideoTrack(
      buildParams(
        bundle,
        {
          timelineRange: { startTicks: 0, durationTicks: 1_524_096_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 1_524_096_000_000 },
        },
        1_524_096_000_000,
      ),
    );
    expect(state).not.toBeNull();
    expect(state!.copyEndS).toBe(6);
    expect(state!.wholeStream).toBe(false);
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

  // A real (dense, per-frame) 30fps CFR packet stream, unlike the sparse
  // GOP-boundary fixtures above which have too few packets to judge uniformity.
  function densePackets(count: number, intervalS: number, keyEvery = 30): MockPacket[] {
    return Array.from({ length: count }, (_, i) =>
      makePacket(i * intervalS, i % keyEvery === 0 ? 'key' : 'delta', intervalS),
    );
  }

  it('accepts a real dense CFR source (uniform 1/30s packet intervals)', async () => {
    const packets = densePackets(60, 1 / 30);
    const bundle = makeOpenInput({}, packets);
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    expect(state).not.toBeNull();
  });

  it('rejects a VFR source whose average packet rate coincidentally matches the requested fps', async () => {
    // Alternating 20ms/47ms gaps average to ~29.9fps (passes the 0.5% average-rate
    // gate) but no two consecutive frames are 1/30s apart — the exact case that
    // slipped through the average-only check and shipped VFR into a "CFR" export.
    const gaps = [0.02, 0.047];
    let t = 0;
    const packets: MockPacket[] = [];
    for (let i = 0; i < 40; i++) {
      packets.push(makePacket(t, i % 30 === 0 ? 'key' : 'delta', gaps[i % 2]));
      t += gaps[i % 2]!;
    }
    const bundle = makeOpenInput(
      {
        computePacketStats: vi
          .fn()
          .mockResolvedValue({ averagePacketRate: 30, averageBitrate: 4_000_000 }),
      },
      packets,
    );
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    expect(state).toBeNull();
    expect(bundle.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('isSourceFrameIntervalUniform', () => {
  it('returns true (trusts the average gate) when too few packets to judge', async () => {
    const sink = makeSink([makePacket(0, 'key'), makePacket(5, 'delta')]);
    expect(await isSourceFrameIntervalUniform({ packetSink: sink, requestedFps: 30 })).toBe(true);
  });

  it('returns true for a dense uniform-interval stream', async () => {
    const packets = Array.from({ length: 30 }, (_, i) => makePacket(i / 30, 'delta'));
    const sink = makeSink(packets);
    expect(await isSourceFrameIntervalUniform({ packetSink: sink, requestedFps: 30 })).toBe(true);
  });

  it('returns false for a dense jittery-interval stream', async () => {
    const gaps = [0.02, 0.047];
    let t = 0;
    const packets: MockPacket[] = [];
    for (let i = 0; i < 30; i++) {
      packets.push(makePacket(t, 'delta'));
      t += gaps[i % 2]!;
    }
    const sink = makeSink(packets);
    expect(await isSourceFrameIntervalUniform({ packetSink: sink, requestedFps: 30 })).toBe(false);
  });

  it('tolerates small container/timebase rounding noise', async () => {
    // Sub-millisecond jitter typical of rational timebases (e.g. 1001/30000).
    const packets = Array.from({ length: 30 }, (_, i) =>
      makePacket(i / 30 + (i % 2 === 0 ? 0.0001 : -0.0001), 'delta'),
    );
    const sink = makeSink(packets);
    expect(await isSourceFrameIntervalUniform({ packetSink: sink, requestedFps: 30 })).toBe(true);
  });
});

describe('findLastNeededPacketIndex', () => {
  it('keeps forward references needed by in-window B-frames', async () => {
    // Decode order with reordering: key0, P3, B1, B2, P6, B4, B5, key9.
    // Cut at 6s: B4/B5 display inside the window but decode after P6, so the
    // last needed decode index is B5 (6) — P6 must be copied, key9 must not.
    const packets = [
      makePacket(0, 'key'),
      makePacket(3, 'delta'),
      makePacket(1, 'delta'),
      makePacket(2, 'delta'),
      makePacket(6, 'delta'),
      makePacket(4, 'delta'),
      makePacket(5, 'delta'),
      makePacket(9, 'key'),
    ];
    const sink = makeSink(packets);
    const lastNeeded = await findLastNeededPacketIndex({
      packetSink: sink,
      startPacket: packets[0]!,
      copyEndS: 6,
    });
    expect(lastNeeded).toBe(6);
  });

  it('returns -1 when nothing displays inside the window', async () => {
    const packets = [makePacket(5, 'key')];
    const sink = makeSink(packets);
    const lastNeeded = await findLastNeededPacketIndex({
      packetSink: sink,
      startPacket: packets[0]!,
      copyEndS: 3,
    });
    expect(lastNeeded).toBe(-1);
  });
});

describe('writeVideoPassthrough', () => {
  it('copies the whole stream with decoderConfig on the first packet', async () => {
    const bundle = makeOpenInput();
    const state = await buildPassthroughVideoTrack(buildParams(bundle));
    const disposeInput = vi.fn();
    const progress: number[] = [];
    await writeVideoPassthrough({
      state: state!,
      ensureNotCancelled: () => {},
      onProgress: (p) => progress.push(p),
      disposeInput,
    });

    expect(bundle.videoSource.add).toHaveBeenCalledTimes(2);
    expect(bundle.videoSource.add.mock.calls[0]![1]).toEqual({
      decoderConfig: { codec: 'avc1.64001f' },
    });
    expect(bundle.videoSource.add.mock.calls[1]![1]).toBeUndefined();
    // Untrimmed head: packets pass through without cloning.
    expect(bundle.videoSource.add.mock.calls[0]![0]).toMatchObject({ timestamp: 0 });
    expect(progress.at(-1)).toBe(1);
    expect(disposeInput).toHaveBeenCalledWith(state!.input);
  });

  it('shifts timestamps to zero for a head-trimmed copy', async () => {
    const packets = [makePacket(0, 'key', 2), makePacket(2, 'key', 4), makePacket(6, 'delta', 4)];
    const bundle = makeOpenInput({}, packets);
    const state = await buildPassthroughVideoTrack(
      buildParams(
        bundle,
        {
          timelineRange: { startTicks: 0, durationTicks: 2_032_128_000_000 },
          sourceRange: {
            startTicks: 508_032_000_000,
            durationTicks: 2_032_128_000_000,
          },
        },
        2_032_128_000_000,
      ),
    );
    await writeVideoPassthrough({
      state: state!,
      ensureNotCancelled: () => {},
      disposeInput: vi.fn(),
    });

    // Copy starts at the 2s keyframe (index 1) and shifts by -2s.
    expect(bundle.videoSource.add).toHaveBeenCalledTimes(2);
    expect(bundle.videoSource.add.mock.calls[0]![0]).toMatchObject({ timestamp: 0, cloned: true });
    expect(bundle.videoSource.add.mock.calls[1]![0]).toMatchObject({ timestamp: 4, cloned: true });
  });

  it('stops a tail-trimmed copy after the last needed packet, keeping forward refs', async () => {
    const packets = [
      makePacket(0, 'key'),
      makePacket(3, 'delta'),
      makePacket(1, 'delta'),
      makePacket(2, 'delta'),
      makePacket(6, 'delta'),
      makePacket(4, 'delta'),
      makePacket(5, 'delta'),
      makePacket(9, 'key'),
    ];
    const bundle = makeOpenInput({}, packets);
    const state = await buildPassthroughVideoTrack(
      buildParams(
        bundle,
        {
          timelineRange: { startTicks: 0, durationTicks: 1_524_096_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 1_524_096_000_000 },
        },
        1_524_096_000_000,
      ),
    );
    expect(state!.wholeStream).toBe(false);
    await writeVideoPassthrough({
      state: state!,
      ensureNotCancelled: () => {},
      disposeInput: vi.fn(),
    });

    // 7 packets copied (incl. the P6 forward reference), key9 excluded.
    expect(bundle.videoSource.add).toHaveBeenCalledTimes(7);
    const copied = bundle.videoSource.add.mock.calls.map(
      (call) => (call[0] as { timestamp: number }).timestamp,
    );
    expect(copied).toEqual([0, 3, 1, 2, 6, 4, 5]);
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
