import type { DecodeRequest, DecodeResponse } from '../utils/audio/types';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';

interface InputLike<TAudioTrack = unknown> {
  getPrimaryAudioTrack(): Promise<TAudioTrack | null>;
  computeDuration(): Promise<number>;
  dispose?(): void;
  close?(): void;
}

interface AudioSampleSinkLike {
  samples(...args: number[]): AsyncIterable<unknown>;
  close?(): void;
  dispose?(): void;
}

interface AudioTrackLike {
  canDecode(): Promise<boolean>;
}

interface AudioInputOptionsLike {
  source: unknown;
  formats: unknown;
}

export interface AudioDecodeEngineDeps<
  TAudioTrack extends AudioTrackLike = AudioTrackLike,
  TInputOptions extends AudioInputOptionsLike = AudioInputOptionsLike,
> {
  AudioSampleSink: new (audioTrack: TAudioTrack) => AudioSampleSinkLike;
  Input: new (options: TInputOptions) => InputLike<TAudioTrack>;
  BlobSource: new (blob: Blob) => unknown;
  ALL_FORMATS: unknown;
  governedBlobWorker?: (blob: Blob) => Blob;
}

interface CachedDecodeSource<TAudioTrack = unknown> {
  input: InputLike<TAudioTrack>;
  sink: AudioSampleSinkLike;
}

export class AudioDecodeEngine<
  TAudioTrack extends AudioTrackLike = AudioTrackLike,
  TInputOptions extends AudioInputOptionsLike = AudioInputOptionsLike,
> {
  private readonly decodeSourceCache = new Map<string, CachedDecodeSource<TAudioTrack>>();
  private readonly decodeSourceLocks = new Map<string, Promise<void>>();
  private activeGlobalDecodes = 0;
  private readonly globalDecodeQueue: Array<() => void> = [];

  constructor(
    private readonly deps: AudioDecodeEngineDeps<TAudioTrack, TInputOptions>,
    private readonly maxCachedSources = 16,
    private readonly maxGlobalDecodeSlots = 2,
  ) {}

  reset(): void {
    for (const cached of Array.from(this.decodeSourceCache.values())) {
      this.disposeDecodeSource(cached);
    }
    this.decodeSourceCache.clear();
    this.decodeSourceLocks.clear();
    this.activeGlobalDecodes = 0;
    this.globalDecodeQueue.length = 0;
  }

  async handleRequest(data: DecodeRequest): Promise<DecodeResponse> {
    const response: DecodeResponse = {
      type: 'decode-result',
      id: data.id,
      ok: false,
    };

    try {
      if (data.type === 'extract-peaks') {
        const peaks = await this.withGlobalDecodeSlot(() =>
          this.extractPeaksFromSource(
            data.blob ?? data.arrayBuffer ?? new ArrayBuffer(0),
            data.options,
          ),
        );
        response.ok = true;
        response.result = {
          sampleRate: 48000,
          numberOfChannels: peaks.length,
          channelBuffers: [],
          peaks,
        };
        return response;
      }

      if (data.type === 'decode-stt') {
        const result = await this.withGlobalDecodeSlot(() =>
          this.decodeToSttMono(
            data.blob ?? data.arrayBuffer ?? new ArrayBuffer(0),
            data.options?.targetSampleRate || 16000,
          ),
        );
        response.ok = true;
        response.result = {
          sampleRate: result.sampleRate,
          numberOfChannels: 1,
          channelBuffers: [],
          sttAudio: result.sttAudio,
        };
        return response;
      }

      if (data.type === 'decode-range') {
        const result = await this.withGlobalDecodeSlot(() =>
          this.withDecodeSourceLock(data.sourceKey, () =>
            this.decodeToFloat32Channels(
              data.arrayBuffer ?? data.blob ?? new ArrayBuffer(0),
              data.sourceKey,
              data.startTimeS ?? 0,
              data.durationS,
            ),
          ),
        );

        response.ok = true;
        response.result = { ...result };
        return response;
      }

      const result = await this.withGlobalDecodeSlot(() =>
        this.withDecodeSourceLock(data.sourceKey, () =>
          this.decodeToFloat32Channels(
            data.arrayBuffer ?? data.blob ?? new ArrayBuffer(0),
            data.sourceKey,
          ),
        ),
      );

      response.ok = true;
      response.result = { ...result };
      return response;
    } catch (rawErr) {
      const err = rawErr as Record<string, unknown>;
      let errName = err.name;
      if (err.message === 'Input has an unsupported or unrecognizable format.') {
        errName = 'UnsupportedFormatError';
      }
      response.ok = false;
      response.error = {
        name: errName as string | undefined,
        message: (err.message || String(err)) as string,
        stack: err.stack as string | undefined,
      };
      return response;
    }
  }

  private async withGlobalDecodeSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeGlobalDecodes >= this.maxGlobalDecodeSlots) {
      await new Promise<void>((resolve) => this.globalDecodeQueue.push(resolve));
    }
    this.activeGlobalDecodes += 1;
    try {
      return await task();
    } finally {
      this.activeGlobalDecodes = Math.max(0, this.activeGlobalDecodes - 1);
      const next = this.globalDecodeQueue.shift();
      if (next) next();
    }
  }

  private disposeDecodeSource(source: CachedDecodeSource) {
    const sink = source.sink as { close?: () => void; dispose?: () => void };
    const input = source.input as { dispose?: () => void; close?: () => void };
    if (typeof sink.close === 'function') sink.close();
    if (typeof sink.dispose === 'function') sink.dispose();
    if (typeof input.dispose === 'function') input.dispose();
    else if (typeof input.close === 'function') input.close();
  }

  private async getCachedDecodeSource(
    sourceKey: string | undefined,
    source: Blob | ArrayBuffer,
  ): Promise<CachedDecodeSource & { cached: boolean }> {
    if (sourceKey) {
      const cached = this.decodeSourceCache.get(sourceKey);
      if (cached) {
        this.decodeSourceCache.delete(sourceKey);
        this.decodeSourceCache.set(sourceKey, cached);
        return { ...cached, cached: true };
      }
    }

    const blob = source instanceof Blob ? source : new Blob([source]);
    const input = new this.deps.Input({
      source: new this.deps.BlobSource((this.deps.governedBlobWorker ?? governedBlobWorker)(blob)),
      formats: this.deps.ALL_FORMATS,
    } as TInputOptions);
    let aTrack: TAudioTrack;
    try {
      const primaryAudioTrack = await input.getPrimaryAudioTrack();
      if (!primaryAudioTrack) {
        const err = new Error('No audio track');
        (err as Error).name = 'NoAudioTrackError';
        throw err;
      }
      aTrack = primaryAudioTrack;
      if (!(await aTrack.canDecode())) {
        throw new Error('Audio track cannot be decoded');
      }
    } catch (err) {
      const inputDispose = input as { dispose?: () => void; close?: () => void };
      if (typeof inputDispose.dispose === 'function') inputDispose.dispose();
      else if (typeof inputDispose.close === 'function') inputDispose.close();
      throw err;
    }

    const entry: CachedDecodeSource<TAudioTrack> = {
      input,
      sink: new this.deps.AudioSampleSink(aTrack),
    };
    if (sourceKey) {
      this.decodeSourceCache.set(sourceKey, entry);
      while (this.decodeSourceCache.size > this.maxCachedSources) {
        const oldestKey = this.decodeSourceCache.keys().next().value;
        if (!oldestKey) break;
        const oldest = this.decodeSourceCache.get(oldestKey);
        this.decodeSourceCache.delete(oldestKey);
        if (oldest) this.disposeDecodeSource(oldest);
      }
      return { ...entry, cached: true };
    }

    return { ...entry, cached: false };
  }

  private async withDecodeSourceLock<T>(sourceKey: string | undefined, task: () => Promise<T>) {
    if (!sourceKey) return task();

    const previous = this.decodeSourceLocks.get(sourceKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.decodeSourceLocks.set(sourceKey, chained);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.decodeSourceLocks.get(sourceKey) === chained) {
        this.decodeSourceLocks.delete(sourceKey);
      }
    }
  }

  async decodeToFloat32Channels(
    source: Blob | ArrayBuffer,
    sourceKey?: string,
    rangeStartTimeS = 0,
    rangeDurationS?: number,
  ) {
    const { input, sink, cached } = await this.getCachedDecodeSource(sourceKey, source);

    try {
      const metaDurationS = await input.computeDuration();
      const durationS = Number.isFinite(metaDurationS) && metaDurationS > 0 ? metaDurationS : 0;

      let sampleRate = 48000;
      let numberOfChannels: number | undefined;
      let actualStartTimeS: number | undefined;

      const channelChunks: Array<{ startFrame: number; planes: Float32Array[]; frames: number }> =
        [];
      let maxFrame = 0;

      const decodeStartS = rangeStartTimeS;
      const decodeEndS = rangeDurationS ? rangeStartTimeS + rangeDurationS : durationS || 1e9;

      for await (const sampleRaw of (
        sink as { samples: (...args: number[]) => AsyncIterable<unknown> }
      ).samples(decodeStartS, decodeEndS)) {
        const sample = sampleRaw as {
          sampleRate: number;
          numberOfChannels: number;
          numberOfFrames: number;
          timestamp: number;
          allocationSize: (options: { format: 'f32-planar'; planeIndex: number }) => number;
          copyTo: (
            dst: Float32Array,
            options: { format: 'f32-planar'; planeIndex: number },
          ) => void;
          close: () => void;
        };
        try {
          sampleRate = Math.max(1, Number(sample.sampleRate) || sampleRate);
          const sampleChannels = Math.max(1, Number(sample.numberOfChannels) || 1);
          if (numberOfChannels === undefined) {
            numberOfChannels = sampleChannels;
          } else if (sampleChannels > numberOfChannels) {
            numberOfChannels = sampleChannels;
          }

          const frames = Number(sample.numberOfFrames) || 0;
          if (frames > 0) {
            const ts = Number(sample.timestamp);
            const sampleStartS = Number.isFinite(ts) ? ts : decodeStartS + maxFrame / sampleRate;
            if (actualStartTimeS === undefined) {
              actualStartTimeS = sampleStartS;
            }
            const planes: Float32Array[] = [];
            const availableChannels = Math.min(numberOfChannels, sampleChannels);
            for (let ch = 0; ch < availableChannels; ch += 1) {
              const bytesNeeded = sample.allocationSize({ format: 'f32-planar', planeIndex: ch });
              const chunk = new Float32Array(bytesNeeded / 4);
              sample.copyTo(chunk, { format: 'f32-planar', planeIndex: ch });
              planes.push(chunk);
            }
            const startFrame = Math.round((sampleStartS - decodeStartS) * sampleRate);
            channelChunks.push({ startFrame, planes, frames });
            maxFrame = Math.max(maxFrame, Math.max(0, startFrame + frames));
          }
        } finally {
          if (typeof sample.close === 'function') sample.close();
        }
      }

      const windowFrames =
        rangeDurationS && Number.isFinite(rangeDurationS)
          ? Math.max(0, Math.round(rangeDurationS * sampleRate))
          : maxFrame;
      const totalFrames = Math.max(windowFrames, maxFrame);
      const resolvedChannels = numberOfChannels ?? 2;

      if (totalFrames <= 0 || channelChunks.length === 0) throw new Error('Decoded audio is empty');

      const channelBuffers = Array.from({ length: resolvedChannels }, (_, ch) => {
        const combined = new Float32Array(totalFrames);
        for (const chunk of channelChunks) {
          const plane = chunk.planes[ch];
          if (!plane?.length) continue;
          copyPlanarSampleToChannelBuffers({
            sample: {
              numberOfFrames: chunk.frames,
              timestamp: decodeStartS + chunk.startFrame / sampleRate,
              allocationSize: () => plane.byteLength,
              copyTo: (dst) => dst.set(plane.subarray(0, dst.length)),
            },
            planes: [combined],
            decodeStartS,
            sampleRate,
            numberOfChannels: 1,
          });
        }
        return combined.buffer as ArrayBuffer;
      });

      return {
        sampleRate,
        numberOfChannels: resolvedChannels,
        channelBuffers,
        startTimeS: decodeStartS,
        actualStartTimeS: rangeDurationS ? decodeStartS : (actualStartTimeS ?? decodeStartS),
        durationS: totalFrames / sampleRate,
        totalFrames,
      };
    } finally {
      if (!cached) this.disposeDecodeSource({ input, sink });
    }
  }

  async extractPeaksFromSource(
    source: Blob | ArrayBuffer,
    options?: { maxLength?: number; precision?: number },
  ): Promise<Float32Array[]> {
    const maxLength = options?.maxLength || 8000;
    const precision = options?.precision || 10000;
    const blob = source instanceof Blob ? source : new Blob([source]);
    const input = new this.deps.Input({
      source: new this.deps.BlobSource((this.deps.governedBlobWorker ?? governedBlobWorker)(blob)),
      formats: this.deps.ALL_FORMATS,
    } as TInputOptions);

    try {
      const aTrack = await input.getPrimaryAudioTrack();
      if (!aTrack) {
        const err = new Error('No audio track');
        (err as Error).name = 'NoAudioTrackError';
        throw err;
      }
      if (!(await aTrack.canDecode())) {
        throw new Error('Audio track cannot be decoded');
      }

      const sink = new this.deps.AudioSampleSink(aTrack);
      try {
        const metaDurationS = await input.computeDuration();
        const durationS = Number.isFinite(metaDurationS) && metaDurationS > 0 ? metaDurationS : 0;
        const trackSampleRate = Math.max(
          1,
          (aTrack as { sampleRate?: number }).sampleRate || 48000,
        );
        let totalFramesEstimate = Math.max(1, Math.ceil(durationS * trackSampleRate));
        const peaks: Float32Array[] = [];
        let resolvedChannels = 0;

        for await (const sampleRaw of (
          sink as { samples: (...args: number[]) => AsyncIterable<unknown> }
        ).samples(0, durationS || 1e9)) {
          const sample = sampleRaw as {
            numberOfFrames?: number;
            numberOfChannels?: number;
            sampleRate?: number;
            timestamp?: number;
            allocationSize?: (opts: { format: string; planeIndex: number }) => number;
            copyTo?: (dst: ArrayBufferView, opts: { format: string; planeIndex: number }) => void;
            close?: () => void;
          };
          try {
            const frames = Number(sample.numberOfFrames) || 0;
            const numberOfChannels = Math.max(1, Number(sample.numberOfChannels) || 1);
            const sampleRate = Math.max(1, Number(sample.sampleRate) || trackSampleRate);
            if (frames <= 0) continue;

            if (resolvedChannels === 0) {
              resolvedChannels = numberOfChannels;
              for (let ch = 0; ch < resolvedChannels; ch += 1) {
                peaks.push(new Float32Array(maxLength));
              }
            } else if (numberOfChannels > resolvedChannels) {
              for (let ch = resolvedChannels; ch < numberOfChannels; ch += 1) {
                peaks.push(new Float32Array(maxLength));
              }
              resolvedChannels = numberOfChannels;
            }

            const timestampS = Number(sample.timestamp) || 0;
            const startFrameTrack = Math.max(0, Math.round(timestampS * trackSampleRate));
            const framesInTrackRate = Math.round(frames * (trackSampleRate / sampleRate));
            const lastFrameTrack = startFrameTrack + framesInTrackRate;

            if (lastFrameTrack > totalFramesEstimate) {
              const oldEstimate = totalFramesEstimate;
              totalFramesEstimate = lastFrameTrack;
              const ratio = oldEstimate / totalFramesEstimate;
              for (let ch = 0; ch < resolvedChannels; ch += 1) {
                const channel = peaks[ch];
                if (!channel) continue;
                const newChannel = new Float32Array(maxLength);
                for (let b = 0; b < maxLength; b += 1) {
                  const newB = Math.min(maxLength - 1, Math.floor(b * ratio));
                  if (channel[b]! > newChannel[newB]!) {
                    newChannel[newB] = channel[b]!;
                  }
                }
                peaks[ch] = newChannel;
              }
            }

            const channelsToCopy = Math.min(resolvedChannels, numberOfChannels);
            const timePerFrame = 1 / sampleRate;

            for (let ch = 0; ch < channelsToCopy; ch += 1) {
              const bytesNeeded = sample.allocationSize!({ format: 'f32-planar', planeIndex: ch });
              const channel = new Float32Array(bytesNeeded / 4);
              sample.copyTo!(channel, { format: 'f32-planar', planeIndex: ch });

              const peakChannel = peaks[ch];
              if (!peakChannel) continue;
              for (let i = 0; i < frames && i < channel.length; i += 1) {
                const frameTime = timestampS + i * timePerFrame;
                const globalFrame = Math.max(0, Math.floor(frameTime * trackSampleRate));
                const bucket = Math.min(
                  maxLength - 1,
                  Math.max(0, Math.floor((globalFrame / totalFramesEstimate) * maxLength)),
                );
                const value = Math.abs(channel[i] ?? 0);
                if (value > peakChannel[bucket]!) {
                  peakChannel[bucket] = value;
                }
              }
            }
          } finally {
            if (typeof sample.close === 'function') sample.close();
          }
        }

        if (peaks.length === 0) {
          throw new Error('Decoded audio is empty');
        }

        for (const channel of peaks) {
          for (let i = 0; i < channel.length; i += 1) {
            channel[i] = Math.round((channel[i] ?? 0) * precision) / precision;
          }
        }
        return peaks;
      } finally {
        (sink as { close?: () => void }).close?.();
        (sink as { dispose?: () => void }).dispose?.();
      }
    } finally {
      (input as { dispose?: () => void }).dispose?.();
      (input as { close?: () => void }).close?.();
    }
  }

  async decodeToSttMono(source: Blob | ArrayBuffer, targetSampleRate = 16000) {
    const blob = source instanceof Blob ? source : new Blob([source]);
    const input = new this.deps.Input({
      source: new this.deps.BlobSource((this.deps.governedBlobWorker ?? governedBlobWorker)(blob)),
      formats: this.deps.ALL_FORMATS,
    } as TInputOptions);

    try {
      const aTrack = await input.getPrimaryAudioTrack();
      if (!aTrack) {
        throw new Error('No audio track found in media');
      }
      if (!(await aTrack.canDecode())) {
        throw new Error('Audio track cannot be decoded');
      }

      const sink = new this.deps.AudioSampleSink(aTrack);
      try {
        const metaDurationS = await input.computeDuration();
        const durationS = Number.isFinite(metaDurationS) && metaDurationS > 0 ? metaDurationS : 0;

        const chunks: Float32Array[] = [];
        let totalSamples = 0;
        let sourceRate = 48000;

        for await (const sampleRaw of (
          sink as { samples: (...args: number[]) => AsyncIterable<unknown> }
        ).samples(0, durationS || 1e9)) {
          const sample = sampleRaw as {
            sampleRate?: number;
            numberOfFrames?: number;
            numberOfChannels?: number;
            copyTo?: (dst: ArrayBufferView, opts: { format: string; planeIndex: number }) => void;
            close?: () => void;
          };
          try {
            sourceRate = sample.sampleRate || sourceRate;
            const frames = Number(sample.numberOfFrames) || 0;
            const channels = Math.max(1, Number(sample.numberOfChannels) || 1);
            if (frames <= 0) continue;

            const monoChunk = new Float32Array(frames);
            const channelBuffer = new Float32Array(frames);

            const equalPowerGain = 1 / Math.sqrt(channels);
            for (let ch = 0; ch < channels; ch += 1) {
              sample.copyTo!(channelBuffer, { format: 'f32-planar', planeIndex: ch });
              for (let i = 0; i < frames; i += 1) {
                monoChunk[i] = (monoChunk[i] ?? 0) + (channelBuffer[i] ?? 0) * equalPowerGain;
              }
            }

            chunks.push(monoChunk);
            totalSamples += frames;
          } finally {
            if (typeof sample.close === 'function') sample.close();
          }
        }

        if (totalSamples <= 0) throw new Error('Decoded audio is empty');

        const fullMonoSource = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of chunks) {
          fullMonoSource.set(chunk, offset);
          offset += chunk.length;
        }

        const sttAudio = resample(fullMonoSource, sourceRate, targetSampleRate);

        return {
          sampleRate: targetSampleRate,
          numberOfChannels: 1,
          sttAudio,
        };
      } finally {
        (sink as { close?: () => void }).close?.();
        (sink as { dispose?: () => void }).dispose?.();
      }
    } finally {
      (input as { dispose?: () => void }).dispose?.();
      (input as { close?: () => void }).close?.();
    }
  }
}

export function resample(
  audio: Float32Array,
  currentRate: number,
  targetRate: number,
): Float32Array {
  if (currentRate === targetRate) return audio;
  const ratio = currentRate / targetRate;
  const newLength = Math.round(audio.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const fraction = pos - index;
    const a = audio[index] || 0;
    const b = audio[index + 1] || a;
    result[i] = a + (b - a) * fraction;
  }
  return result;
}

interface PlanarSampleCopyInput {
  sample: {
    numberOfFrames: number;
    timestamp: number;
    allocationSize(options: { format: 'f32-planar'; planeIndex: number }): number;
    copyTo(dst: Float32Array, options: { format: 'f32-planar'; planeIndex: number }): void;
  };
  planes: Float32Array[];
  decodeStartS: number;
  sampleRate: number;
  numberOfChannels: number;
}

export function copyPlanarSampleToChannelBuffers(params: PlanarSampleCopyInput): number {
  const frames = Number(params.sample.numberOfFrames) || 0;
  if (frames <= 0) return 0;

  const desiredFrameOffset = Math.round(
    (Number(params.sample.timestamp) - params.decodeStartS) * params.sampleRate,
  );
  const skipFramesInSample = Math.max(0, -desiredFrameOffset);
  const writeFrameOffset = Math.max(0, desiredFrameOffset);
  const totalFrames = params.planes[0]?.length ?? 0;
  if (totalFrames <= 0 || writeFrameOffset >= totalFrames || skipFramesInSample >= frames) {
    return 0;
  }

  const framesAvailable = frames - skipFramesInSample;
  const framesToCopy = Math.min(framesAvailable, totalFrames - writeFrameOffset);
  if (framesToCopy <= 0) return 0;

  const channelsToCopy = Math.min(params.numberOfChannels, params.planes.length);
  for (let ch = 0; ch < channelsToCopy; ch += 1) {
    const bytesNeeded = params.sample.allocationSize({ format: 'f32-planar', planeIndex: ch });
    const sourcePlane = new Float32Array(bytesNeeded / 4);
    params.sample.copyTo(sourcePlane, { format: 'f32-planar', planeIndex: ch });

    const copyEnd = Math.min(sourcePlane.length, skipFramesInSample + framesToCopy);
    if (copyEnd <= skipFramesInSample) continue;

    params.planes[ch]?.set(sourcePlane.subarray(skipFramesInSample, copyEnd), writeFrameOffset);
  }

  return framesToCopy;
}
