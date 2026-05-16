/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AudioEngine } from '~/utils/video-editor/AudioEngine';

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
  gain = { value: 1 };
  connect = vi.fn();
}

class AudioBufferMock {
  public duration: number;
  public numberOfChannels: number;
  public length: number;
  public sampleRate: number;
  public copyToChannel = vi.fn();

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
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

function createClip(overrides: Partial<Parameters<AudioEngine['loadClips']>[0][number]> = {}) {
  return {
    id: 'clip-1',
    sourcePath: 'audio.mp3',
    fileHandle: createFileHandle(),
    startUs: 0,
    durationUs: 1_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 1_000_000,
    sourceDurationUs: 1_000_000,
    DurationUs: 1_000_000,
    ...overrides,
  };
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
    vi.unstubAllGlobals();
  });

  it('initializes audio context and clamps volume', async () => {
    const engine = new AudioEngine();
    await engine.init();

    expect(audioContextInstance).toBeTruthy();
    engine.setMasterVolume(2);
    expect(audioContextInstance?.createdGains[0]?.gain.value).toBe(2);

    engine.setMasterVolume(-1);
    expect(audioContextInstance?.createdGains[0]?.gain.value).toBe(0);
  });

  it('resumes suspended context on play', async () => {
    const engine = new AudioEngine();
    await engine.init();

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.state = 'suspended';

    await engine.play(0);

    expect(audioContextInstance.resume).toHaveBeenCalledTimes(1);
  });

  it('decodes a source only once for identical clips', async () => {
    const engine = new AudioEngine();
    await engine.init();

    const clips = [createClip(), createClip({ id: 'clip-2' })];
    await engine.loadClips(clips);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(workerInstance?.postMessage).toHaveBeenCalledTimes(1);
  });

  it('schedules playback and stops nodes', async () => {
    const engine = new AudioEngine();
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

  it('does not schedule audio for negative-speed clips', async () => {
    const engine = new AudioEngine();
    await engine.init();

    const clip = createClip({ speed: -1 });
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (!audioContextInstance) throw new Error('AudioContext not initialized');

    await engine.play(0);

    expect(audioContextInstance.createdSources.length).toBe(0);
  });

  it('retries playback after seek when playing', async () => {
    const engine = new AudioEngine();
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

  it('does not schedule stale playback after stopping while decode is in flight', async () => {
    workerResponseDelayMs = 20;
    const engine = new AudioEngine();
    await engine.init();

    await engine.loadClips([createClip()]);
    await engine.play(0);
    engine.stop();

    await new Promise<void>((resolve) => setTimeout(resolve, 40));

    expect(audioContextInstance?.createdSources.length).toBe(0);
  });

  it('plays forward scrub preview without enabling playback state', async () => {
    const engine = new AudioEngine();
    await engine.init();

    const clip = createClip({
      durationUs: 2_000_000,
      sourceRangeDurationUs: 2_000_000,
      sourceDurationUs: 2_000_000,
    });
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (!audioContextInstance) throw new Error('AudioContext not initialized');
    audioContextInstance.currentTime = 3;

    await engine.previewScrubForward(100_000, 160_000, 75_000);

    expect(audioContextInstance.createdSources.length).toBe(1);
    const source = audioContextInstance.createdSources[0];
    expect(source.start).toHaveBeenCalledTimes(1);

    engine.stopScrubPreview();
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(engine.getCurrentTimeUs()).toBe(0);
  });

  it('does not retry permanent decode failures', async () => {
    workerOk = false;
    workerErrorName = 'UnsupportedFormatError';
    const engine = new AudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    workerOk = true;
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(workerInstance?.postMessage).toHaveBeenCalledTimes(1);
  });

  it('retries transient decode failures the next time the chunk is requested', async () => {
    workerOk = false;
    workerErrorName = undefined;
    const engine = new AudioEngine();
    await engine.init();

    const clip = createClip();
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    workerOk = true;
    await engine.loadClips([clip]);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(workerInstance?.postMessage).toHaveBeenCalledTimes(2);
  });

  it('decodes every chunk needed for a multi-chunk clip', async () => {
    // Clip covers 12s of source — needs chunks 0, 1, and 2 (5s each).
    const engine = new AudioEngine();
    await engine.init();

    const clip = createClip({
      durationUs: 12_000_000,
      sourceRangeDurationUs: 12_000_000,
      sourceDurationUs: 12_000_000,
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

  it('decodes the correct chunk when playback starts in the middle of the source', async () => {
    // Clip uses source seconds 7..12, so the first chunk needed is index 1
    // (covers 5..10s in source time).
    const engine = new AudioEngine();
    await engine.init();

    const clip = createClip({
      durationUs: 5_000_000,
      sourceStartUs: 7_000_000,
      sourceRangeDurationUs: 5_000_000,
      sourceDurationUs: 20_000_000,
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
});
