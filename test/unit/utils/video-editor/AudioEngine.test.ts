/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAudioEngine, type IAudioEngine } from '~/utils/video-editor/AudioEngine';
import { TICKS_PER_MICROSECOND } from '~/utils/time';

interface WorkerMessageEvent<T> {
  data: T;
}

interface DecodeRequest {
  type: 'decode' | 'extract-peaks' | 'decode-range';
  id: number;
  sourceKey: string;
  arrayBuffer?: ArrayBuffer;
  blob?: Blob;
  startTimeS?: number;
  durationS?: number;
}

interface DecodeResponse {
  type: 'decode-result';
  id: number;
  ok: boolean;
  error?: { name?: string; message: string; stack?: string };
  result?: {
    sampleRate: number;
    numberOfChannels: number;
    channelBuffers: ArrayBuffer[];
    startTimeS?: number;
    actualStartTimeS?: number;
    durationS?: number;
    totalFrames?: number;
  };
}

class WorkerMock {
  private listeners: Record<string, Array<(event: WorkerMessageEvent<any>) => void>> = {};
  public postMessage = vi.fn((payload: DecodeRequest) => {
    if ((payload as any).type === 'io-init') return;

    const response = createWorkerResponse(payload);
    const emitResponse = () => {
      this.emit('message', { data: response });
    };

    if (workerResponseDelayMs > 0) {
      setTimeout(emitResponse, workerResponseDelayMs);
      return;
    }

    queueMicrotask(emitResponse);
  });

  public addEventListener(event: string, handler: (event: WorkerMessageEvent<any>) => void) {
    this.listeners[event] ??= [];
    this.listeners[event].push(handler);
  }

  public terminate = vi.fn();

  private emit(event: string, payload: WorkerMessageEvent<any>) {
    for (const handler of this.listeners[event] ?? []) {
      handler(payload);
    }
  }
}

class GainNodeMock {
  gain = {
    value: 1,
    setValueAtTime: vi.fn().mockImplementation(function (this: any, val: number) {
      this.value = val;
      return this;
    }),
    linearRampToValueAtTime: vi.fn().mockImplementation(function (this: any, val: number) {
      this.value = val;
      return this;
    }),
    exponentialRampToValueAtTime: vi.fn().mockImplementation(function (this: any, val: number) {
      this.value = val;
      return this;
    }),
    setTargetAtTime: vi.fn().mockImplementation(function (this: any, val: number) {
      this.value = val;
      return this;
    }),
    cancelScheduledValues: vi.fn().mockImplementation(function (this: any) {
      return this;
    }),
    cancelAndHoldAtTime: vi.fn().mockImplementation(function (this: any) {
      return this;
    }),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class AudioBufferMock {
  public duration: number;
  public numberOfChannels: number;
  public length: number;
  public sampleRate: number;
  public copyToChannel = vi.fn();
  private channelData: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number) {
    return this.channelData[channel] ?? new Float32Array(this.length);
  }
}

class AudioBufferSourceNodeMock {
  buffer: AudioBufferMock | null = null;
  playbackRate = { value: 1 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  disconnect = vi.fn();
  onended: (() => void) | null = null;
}

class AudioContextMock {
  public currentTime = 0;
  public state: 'running' | 'suspended' = 'running';
  public resume = vi.fn(async () => {
    this.state = 'running';
  });
  public close = vi.fn(async () => undefined);
  public destination = {};
  public createdSources: AudioBufferSourceNodeMock[] = [];
  public createdGains: GainNodeMock[] = [];
  public createdBuffers: AudioBufferMock[] = [];

  createAnalyser = vi.fn(() => ({
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
  }));

  createGain() {
    const gain = new GainNodeMock();
    this.createdGains.push(gain);
    return gain;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = new AudioBufferMock(numberOfChannels, length, sampleRate);
    this.createdBuffers.push(buffer);
    return buffer;
  }

  createBufferSource() {
    const source = new AudioBufferSourceNodeMock();
    this.createdSources.push(source);
    return source;
  }
}

let workerInstance: WorkerMock | null = null;
let audioContextInstance: AudioContextMock | null = null;
let workerOk = true;
let workerErrorName: string | undefined = undefined;
let workerResponseDelayMs = 0;
// Chunk size matches AudioEngine.chunkSizeS. Each mocked decode-range chunk
// returns this many seconds of (silent) audio.
const CHUNK_SECONDS = 5;
const CHUNK_FRAMES = CHUNK_SECONDS * 48_000;

function createWorkerResponse(payload: DecodeRequest): DecodeResponse {
  if (!workerOk) {
    return {
      type: 'decode-result',
      id: payload.id,
      ok: false,
      error: { name: workerErrorName, message: 'Decode failed' },
    };
  }

  const isRange = payload.type === 'decode-range';
  const startTimeS = isRange ? (payload.startTimeS ?? 0) : 0;
  const durationS = isRange ? (payload.durationS ?? CHUNK_SECONDS) : CHUNK_SECONDS;
  const frames = isRange ? Math.round(durationS * 48_000) : CHUNK_FRAMES;
  return {
    type: 'decode-result',
    id: payload.id,
    ok: true,
    result: {
      sampleRate: 48_000,
      numberOfChannels: 1,
      channelBuffers: [new Float32Array(frames).buffer],
      startTimeS,
      actualStartTimeS: startTimeS,
      durationS,
      totalFrames: frames,
    },
  };
}

function createFileHandle() {
  return {
    getFile: vi.fn(async () => ({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(16)),
    })),
  } as unknown as FileSystemFileHandle;
}

function getDecodePostMessageCalls(worker: WorkerMock | null) {
  return (worker?.postMessage.mock.calls ?? []).filter(
    (call) => (call[0] as any).type !== 'io-init',
  );
}

function createClip(overrides: Partial<Parameters<IAudioEngine['loadClips']>[0][number]> = {}) {
  const clip = {
    id: 'clip-1',
    sourcePath: 'audio.mp3',
    fileHandle: createFileHandle(),
    startTicks: 0,
    durationTicks: 1_000_000,
    sourceStartTicks: 0,
    sourceRangeDurationTicks: 1_000_000,
    sourceDurationTicks: 1_000_000,
    DurationTicks: 1_000_000,
    ...overrides,
  };

  for (const field of [
    'startTicks',
    'durationTicks',
    'sourceStartTicks',
    'sourceRangeDurationTicks',
    'sourceDurationTicks',
    'DurationTicks',
  ] as const) {
    clip[field] *= TICKS_PER_MICROSECOND;
  }

  return clip;
}

describe('AudioEngine', () => {
  beforeEach(() => {
    workerOk = true;
    workerErrorName = undefined;
    workerResponseDelayMs = 0;
    workerInstance = null;
    audioContextInstance = null;

    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          workerInstance = new WorkerMock();
          return workerInstance as any;
        }
      },
    );

    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          audioContextInstance = new AudioContextMock();
          return audioContextInstance as any;
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('initializes audio context and clamps volume', async () => {
    const engine = createAudioEngine();
    await engine.init();

    expect(audioContextInstance).toBeTruthy();
    engine.setMasterVolume(2);
    expect(audioContextInstance?.createdGains[0]?.gain.value).toBe(2);

    engine.setMasterVolume(-1);
    expect(audioContextInstance?.createdGains[0]?.gain.value).toBe(0);
  });

  it('resumes suspended context on play', async () => {
    const engine = createAudioEngine();
    await engine.init();

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.state = 'suspended';

    await engine.play(0);

    expect(audioContextInstance.resume).toHaveBeenCalledTimes(1);
  });

  it('decodes a source only once for identical clips', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clips = [createClip(), createClip({ id: 'clip-2' })];
    await engine.loadClips(clips);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(getDecodePostMessageCalls(workerInstance).length).toBe(1);
  });

  it('schedules playback and stops nodes', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 10;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(audioContextInstance.createdSources.length).toBe(1);
    const source = audioContextInstance.createdSources[0];
    expect(source.start).toHaveBeenCalledTimes(1);

    engine.stop();
    expect(source.stop).toHaveBeenCalledTimes(1);
  });

  it('does not schedule any audio for reversed (negative-speed) clips', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({ speed: -1 });
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (!audioContextInstance) throw new Error('AudioContext not initialized');

    await engine.play(0);

    expect(audioContextInstance.createdSources.length).toBe(0);
  });

  it('retries playback after seek when playing', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await engine.play(0);
    const initialSources = audioContextInstance?.createdSources.length ?? 0;

    engine.seek(500_000);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(audioContextInstance?.createdSources.length).toBeGreaterThan(initialSources);
  });

  it('fades out active playback before stopping nodes on seek', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 10;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const source = audioContextInstance.createdSources[0];
    if (!source) throw new Error('Source was not scheduled');
    const chunkGain = source.connect.mock.calls[0]?.[0] as GainNodeMock | undefined;
    if (!chunkGain) throw new Error('Chunk gain was not connected');
    source.stop.mockClear();
    source.disconnect.mockClear();

    engine.seek(500_000);

    expect(source.stop).toHaveBeenCalledWith(10.02);
    expect(source.disconnect).not.toHaveBeenCalled();
    expect(chunkGain.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(10);
    expect(chunkGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.02);

    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(source.disconnect).toHaveBeenCalled();
  });

  it('fades out active playback before stopping nodes on speed changes', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 20;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const source = audioContextInstance.createdSources[0];
    if (!source) throw new Error('Source was not scheduled');
    const chunkGain = source.connect.mock.calls[0]?.[0] as GainNodeMock | undefined;
    if (!chunkGain) throw new Error('Chunk gain was not connected');
    source.stop.mockClear();
    source.disconnect.mockClear();

    engine.setGlobalSpeed(2);

    expect(source.stop).toHaveBeenCalledWith(20.02);
    expect(source.disconnect).not.toHaveBeenCalled();
    expect(chunkGain.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(20);
    expect(chunkGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 20.02);

    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(source.disconnect).toHaveBeenCalled();
  });

  it('does not schedule stale playback after stopping while decode is in flight', async () => {
    workerResponseDelayMs = 50;
    const engine = createAudioEngine();
    await engine.init();

    await engine.loadClips([createClip()]);
    // Kick off play but don't await — we want to call stop() while play() is
    // still awaiting the first chunk inside prepareForPlayback.
    const playPromise = engine.play(0);
    engine.stop();
    await playPromise;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(audioContextInstance?.createdSources.length).toBe(0);
  });

  it('plays forward scrub preview without enabling playback state', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 2_000_000,
      sourceRangeDurationTicks: 2_000_000,
      sourceDurationTicks: 2_000_000,
    });
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 3;

    await engine.previewScrubForward(
      100_000 * TICKS_PER_MICROSECOND,
      160_000 * TICKS_PER_MICROSECOND,
      75_000 * TICKS_PER_MICROSECOND,
    );

    expect(audioContextInstance.createdSources.length).toBe(1);
    const source = audioContextInstance.createdSources[0];
    expect(source.start).toHaveBeenCalledTimes(1);

    engine.stopScrubPreview();
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(engine.getCurrentTimeTicks()).toBe(0);
  });

  it('scales the scrub preview window by clip speed so fast clips are not cut short', async () => {
    const engine = createAudioEngine();
    await engine.init();

    // Source runs at 2x: 4s of material occupies 2s of timeline.
    const clip = createClip({
      speed: 2,
      startTicks: 0,
      durationTicks: 2_000_000,
      sourceStartTicks: 0,
      sourceRangeDurationTicks: 4_000_000,
      sourceDurationTicks: 10_000_000,
    });
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 3;

    // Request a 150ms (timeline) preview window.
    await engine.previewScrubForward(
      0,
      300_000 * TICKS_PER_MICROSECOND,
      150_000 * TICKS_PER_MICROSECOND,
    );

    expect(audioContextInstance.createdSources.length).toBe(1);
    const source = audioContextInstance.createdSources[0]!;
    // start(when, offset, durationInBufferSeconds): the buffer (source) duration
    // must be timelineWindow * clipSpeed = 0.15 * 2 = 0.3s. Before the fix the
    // cap was applied as if 1x, cutting the preview to 0.15s of source.
    const playedSourceDurationS = (source.start.mock.calls[0]?.[2] ?? 0) as number;
    expect(playedSourceDurationS).toBeCloseTo(0.3, 5);
    expect(source.playbackRate.value).toBe(2);
  });

  it('does not retry permanent decode failures', async () => {
    workerOk = false;
    workerErrorName = 'UnsupportedFormatError';
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    workerOk = true;
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(getDecodePostMessageCalls(workerInstance).length).toBe(1);
  });

  it('retries transient decode failures the next time the chunk is requested', async () => {
    workerOk = false;
    workerErrorName = undefined;
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    workerOk = true;
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(getDecodePostMessageCalls(workerInstance).length).toBe(2);
  });

  it('stops stale head prefetch after a newer timeline layout arrives', async () => {
    workerResponseDelayMs = 50;
    const engine = createAudioEngine();
    await engine.init();

    engine.updateTimelineLayout([
      createClip({
        id: 'old-1',
        sourcePath: 'old-1.mp3',
        durationTicks: 10_000_000,
        sourceRangeDurationTicks: 10_000_000,
        sourceDurationTicks: 10_000_000,
      }),
      createClip({
        id: 'old-2',
        sourcePath: 'old-2.mp3',
        durationTicks: 10_000_000,
        sourceRangeDurationTicks: 10_000_000,
        sourceDurationTicks: 10_000_000,
      }),
    ]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    engine.updateTimelineLayout([
      createClip({
        id: 'new-1',
        sourcePath: 'new-1.mp3',
        durationTicks: 10_000_000,
        sourceRangeDurationTicks: 10_000_000,
        sourceDurationTicks: 10_000_000,
      }),
    ]);

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const sourceKeys = getDecodePostMessageCalls(workerInstance)
      .map(([req]) => (req as DecodeRequest).sourceKey)
      .filter(Boolean);

    expect(sourceKeys).toContain('old-1.mp3');
    expect(sourceKeys).toContain('new-1.mp3');
    expect(sourceKeys).not.toContain('old-2.mp3');
  });

  it('gives up after 3 transient NotReadableError retries', async () => {
    workerOk = false;
    workerErrorName = 'NotReadableError';
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();

    // First 3 attempts each retry the chunk.
    for (let i = 0; i < 3; i += 1) {
      await engine.loadClips([clip]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // 4th attempt: chunk should be permanently failed, no worker call.
    workerOk = true;
    await engine.loadClips([clip]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(getDecodePostMessageCalls(workerInstance).length).toBe(3);
  });

  it('decodes every chunk needed for a multi-chunk clip', async () => {
    // Clip covers 12s of source — needs chunks 0, 1, and 2 (5s each).
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 12_000_000,
      sourceRangeDurationTicks: 12_000_000,
      sourceDurationTicks: 12_000_000,
    });
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 100;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const rangeRequests = workerInstance?.postMessage.mock.calls
      .map(([req]) => req as DecodeRequest)
      .filter((req) => req.type === 'decode-range');
    expect(rangeRequests?.length).toBe(3);
    expect(rangeRequests?.map((r) => r.startTimeS)).toEqual([0, 5, 10]);

    // One AudioBufferSourceNode per chunk, all wired into the clip input gain.
    expect(audioContextInstance.createdSources.length).toBe(3);
    for (const source of audioContextInstance.createdSources) {
      expect(source.start).toHaveBeenCalledTimes(1);
    }
  });

  it('schedules the first source at the future kickoff time, not at ctx.currentTime', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 5;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const source = audioContextInstance.createdSources[0];
    const startArgs = source?.start.mock.calls[0];
    // First arg is `when` in AudioContext time. Must be strictly greater than
    // currentTime so audio kicks off after the latency window (KICKOFF_LATENCY_S).
    expect(startArgs?.[0]).toBeGreaterThan(5);
  });

  it('fades in the first source at the kickoff boundary', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 5;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const source = audioContextInstance.createdSources[0];
    if (!source) throw new Error('Source was not scheduled');
    const chunkGain = source.connect.mock.calls[0]?.[0] as GainNodeMock | undefined;
    if (!chunkGain) throw new Error('Chunk gain was not connected');

    expect(source.start.mock.calls[0]?.[0]).toBe(5.05);
    expect(chunkGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 5.05);
    const fadeInCall = chunkGain.gain.linearRampToValueAtTime.mock.calls.find(
      ([value]) => value === 1,
    );
    expect(fadeInCall?.[1]).toBeCloseTo(5.07, 5);
  });

  it('keeps getCurrentTimeTicks clamped to the requested start until kickoff is reached', async () => {
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 5_000_000,
      sourceRangeDurationTicks: 5_000_000,
      sourceDurationTicks: 5_000_000,
    });
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 5;

    await engine.play(2_000_000);

    // Right after play, ctx.currentTime is still < kickoff (which is +150ms).
    // The timeline clock should therefore report exactly the requested time
    // so the renderer paints the right frame instead of overshooting.
    expect(engine.getCurrentTimeTicks()).toBe(2_000_000);

    // Advance ctx clock past the kickoff window — timeline should now tick.
    audioContextInstance.currentTime = 5.5;
    const tickedTicks = engine.getCurrentTimeTicks();
    expect(tickedTicks).toBeGreaterThan(2_000_000);
  });

  it('schedules early chunk sources before later chunks finish decoding', async () => {
    // 15s clip → needs chunks 0, 1, 2. prefetchHeadChunks warms 0 and 1
    // (in parallel, capped by maxDecodeConcurrency=2). Chunk 2 only starts
    // decoding once the streaming loop reaches it.
    workerResponseDelayMs = 100;
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 15_000_000,
      sourceRangeDurationTicks: 15_000_000,
      sourceDurationTicks: 15_000_000,
    });
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 100;

    await engine.play(0);

    // Once play() resolves (after chunk 0 is ready), the prefetched chunks
    // (0 and 1) get scheduled almost immediately. Chunk 2 is still decoding
    // and shouldn't have a source yet — that's the streaming win: long clips
    // don't wait for the *whole* range.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(audioContextInstance.createdSources.length).toBeGreaterThanOrEqual(1);
    expect(audioContextInstance.createdSources.length).toBeLessThan(3);

    // After the remaining chunk decode (~100ms), all three sources exist.
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    expect(audioContextInstance.createdSources.length).toBe(3);
  });

  it('throttles streaming so it does not pre-schedule the entire clip up front', async () => {
    // 200s clip → 40 chunks. With SCHEDULING_LOOKAHEAD_S = 30s, only ~7
    // chunks should be scheduled ahead at any time, regardless of how long
    // we wait. Past the lookahead window the streaming loop parks itself.
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 200_000_000,
      sourceRangeDurationTicks: 200_000_000,
      sourceDurationTicks: 200_000_000,
    });
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 1000;

    await engine.play(0);
    // Plenty of time for unthrottled streaming to drain the whole clip.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    expect(audioContextInstance.createdSources.length).toBeGreaterThan(0);
    // 30s lookahead / 5s per chunk = 6 chunks; first chunk is already
    // playing (scheduled at kickoff), so up to ~7 active sources.
    expect(audioContextInstance.createdSources.length).toBeLessThanOrEqual(8);
  });

  it('keeps streaming after every scheduled source has ended', async () => {
    // The throttled streaming loop parks itself once it's pre-scheduled
    // SCHEDULING_LOOKAHEAD_S of audio. If real time advances past everything
    // that was queued, the loop must wake up, snap the cursor forward, and
    // schedule more — instead of tearing the clip graph down.
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 500_000_000,
      sourceRangeDurationTicks: 500_000_000,
      sourceDurationTicks: 500_000_000,
    });
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 100;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const sourcesAfterInitial = audioContextInstance.createdSources.length;
    // Lookahead window ~30s ÷ chunk 5s ≈ up to ~7 sources scheduled ahead.
    expect(sourcesAfterInitial).toBeGreaterThanOrEqual(1);
    expect(sourcesAfterInitial).toBeLessThanOrEqual(8);

    // Fast-forward ctx clock past every currently-scheduled source. The
    // streaming loop should wake, gap-compensate, then schedule more.
    audioContextInstance.currentTime += 60;
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    expect(audioContextInstance.createdSources.length).toBeGreaterThan(sourcesAfterInitial);
  });

  it('decodes the correct chunk when playback starts in the middle of the source', async () => {
    // Clip uses source seconds 7..12, so the first chunk needed is index 1
    // (covers 5..10s in source time).
    const engine = createAudioEngine();
    await engine.init();

    const clip = createClip({
      durationTicks: 5_000_000,
      sourceStartTicks: 7_000_000,
      sourceRangeDurationTicks: 5_000_000,
      sourceDurationTicks: 20_000_000,
    });
    await engine.loadClips([clip]);

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 100;

    await engine.play(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const rangeRequests = workerInstance?.postMessage.mock.calls
      .map(([req]) => req as DecodeRequest)
      .filter((req) => req.type === 'decode-range');
    expect(rangeRequests?.map((r) => r.startTimeS).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      5, 10,
    ]);
    expect(audioContextInstance.createdSources.length).toBe(2);
  });

  it('is safe to call destroy() multiple times', async () => {
    const engine = createAudioEngine();
    await engine.init();

    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
  });

  it('returns null from extractPeaks without logging a warning when cancelled by destroy()', async () => {
    workerResponseDelayMs = 100;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const engine = createAudioEngine();
    const fileHandle = createFileHandle();
    const peaksPromise = engine.extractPeaks(fileHandle, 'audio.mp3', { maxLength: 1000 });

    engine.destroy();
    const peaks = await peaksPromise;

    expect(peaks).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
