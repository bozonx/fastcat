import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AudioEngine } from '../../../../src/utils/video-editor/AudioEngine';

interface WorkerMessageEvent<T> {
  data: T;
}

interface DecodeRequest {
  type: 'decode';
  id: number;
  sourceKey: string;
  arrayBuffer: ArrayBuffer;
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
  };
}

class WorkerMock {
  private listeners: Record<string, Array<(event: WorkerMessageEvent<any>) => void>> = {};
  public postMessage = vi.fn((payload: DecodeRequest) => {
    const response = createWorkerResponse(payload.id);
    queueMicrotask(() => {
      this.emit('message', { data: response });
    });
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

function createWorkerResponse(id: number): DecodeResponse {
  if (!workerOk) {
    return {
      type: 'decode-result',
      id,
      ok: false,
      error: { message: 'Decode failed' },
    };
  }
  return {
    type: 'decode-result',
    id,
    ok: true,
    result: {
      sampleRate: 48_000,
      numberOfChannels: 1,
      channelBuffers: [new Float32Array([0, 0, 0, 0]).buffer],
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
    sourceDurationUs: 1_000_000,
    ...overrides,
  };
}

describe('AudioEngine', () => {
  beforeEach(() => {
    workerOk = true;
    workerInstance = null;
    audioContextInstance = null;

    vi.stubGlobal('Worker', class {
      constructor() {
        workerInstance = new WorkerMock();
        return workerInstance as any;
      }
    });

    vi.stubGlobal('AudioContext', class {
      constructor() {
        audioContextInstance = new AudioContextMock();
        return audioContextInstance as any;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes audio context and clamps volume', async () => {
    const engine = new AudioEngine();
    await engine.init();

    expect(audioContextInstance).toBeTruthy();
    engine.setVolume(2);
    expect(audioContextInstance?.createdGains[0]?.gain.value).toBe(1);

    engine.setVolume(-1);
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

    expect(audioContextInstance.createdSources.length).toBe(1);
    const source = audioContextInstance.createdSources[0];
    expect(source.start).toHaveBeenCalledTimes(1);

    engine.stop();
    expect(source.stop).toHaveBeenCalledTimes(1);
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

    expect(audioContextInstance?.createdSources.length).toBeGreaterThan(initialSources);
  });

  it('keeps failed decode cached as null', async () => {
    workerOk = false;
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
});
