import { createDevLogger } from '~/utils/dev-logger';
import { withFileIoSlot } from '~/utils/io/io-governor';
import type { AudioChunk, AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import {
  DecodeWorkerClient,
  DECODE_CANCELLED_MESSAGE,
} from '~/utils/video-editor/decode-worker-client';
import {
  readAudioChunkFromFileCache,
  writeAudioChunkToFileCache,
} from '~/utils/video-editor/audio-chunk-file-cache';
import { SEAM_CROSSFADE_S } from '~/utils/audio/crossfade';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
const log = createDevLogger('AudioChunkDecoder');

export interface AudioChunkDecoderOptions {
  getContext: () => AudioContext | null;
  collectPinnedBuffers: () => Set<AudioBuffer>;
  getVfs?: () => IFileSystemAdapter | null;
  getCacheVfsPath?: () => string | null;
  chunkSizeS?: number;
  maxChunkCount?: number;
}

export interface ExtractAudioPeaksParams {
  fileHandle: FileSystemFileHandle;
  sourceKey: string;
  options?: { maxLength?: number; precision?: number; durationS?: number };
}

export interface EnsureAudioChunkDecodedParams {
  sourceKey: string;
  fileHandle: FileSystemFileHandle;
  chunkIndex: number;
}

export interface GetAudioChunksForRangeParams {
  sourceKey: string;
  fileHandle: FileSystemFileHandle;
  startTimeS: number;
  durationS: number;
}

export interface PrefetchAudioChunksOptions {
  shouldContinue?: () => boolean;
  maxClips?: number;
  concurrency?: number;
}

const DEFAULT_CHUNK_SIZE_S = 5;
const DEFAULT_MAX_CHUNK_COUNT = 100;

export class AudioChunkDecoder {
  private readonly getContext: AudioChunkDecoderOptions['getContext'];
  private readonly collectPinnedBuffers: AudioChunkDecoderOptions['collectPinnedBuffers'];
  private readonly getVfs?: AudioChunkDecoderOptions['getVfs'];
  private readonly getCacheVfsPath?: AudioChunkDecoderOptions['getCacheVfsPath'];
  private readonly chunkSizeS: number;
  private readonly maxChunkCount: number;
  private chunkCache = new Map<string, AudioChunk[]>();
  private chunkDecodeInFlight = new Map<string, Promise<AudioChunk | null>>();
  private failedChunkKeys = new Set<string>();
  private chunkRetryCounts = new Map<string, number>();
  private chunkLruKeys = new Map<string, true>();
  private fileBlobCache = new Map<string, File>();
  // Tracks which FileSystemFileHandle instance backs each source key's cached
  // chunks/blob. Reimport, proxy regeneration, and VFS write-back all hand out
  // a fresh handle for the same path, so a handle-identity change is a cheap,
  // reliable (no I/O) signal that the decoded audio is stale.
  private sourceFileHandles = new Map<string, FileSystemFileHandle>();
  private readonly decodeClient = new DecodeWorkerClient();

  constructor(options: AudioChunkDecoderOptions) {
    this.getContext = options.getContext;
    this.collectPinnedBuffers = options.collectPinnedBuffers;
    this.getVfs = options.getVfs;
    this.getCacheVfsPath = options.getCacheVfsPath;
    this.chunkSizeS = options.chunkSizeS ?? DEFAULT_CHUNK_SIZE_S;
    this.maxChunkCount = options.maxChunkCount ?? DEFAULT_MAX_CHUNK_COUNT;
  }

  getChunkIndex(timeS: number): number {
    return Math.floor(timeS / this.chunkSizeS);
  }

  async extractPeaks(params: ExtractAudioPeaksParams): Promise<Float32Array[] | null> {
    const { fileHandle, sourceKey, options } = params;
    return this.decodeClient.withSlot(async () => {
      try {
        const file = await withFileIoSlot(() => fileHandle.getFile());
        const decoded = await this.decodeClient.extractPeaks(file, sourceKey, options);
        if (!decoded?.peaks) {
          log.warn(`[AudioEngine] Failed to extract peaks for ${sourceKey}`);
          return null;
        }

        return decoded.peaks;
      } catch (err) {
        if (err instanceof Error && err.message === DECODE_CANCELLED_MESSAGE) {
          return null;
        }
        log.warn(`[AudioEngine] Failed to extract peaks for ${sourceKey}`, err);
        return null;
      }
    });
  }

  async prefetchHeadChunks(clips: AudioEngineClip[], options?: PrefetchAudioChunksOptions) {
    const chunksAhead = 2;
    const maxClips = Math.max(0, Math.round(options?.maxClips ?? 8));
    const concurrency = Math.max(1, Math.round(options?.concurrency ?? 1));
    const selectedClips: AudioEngineClip[] = [];
    const selectedSources = new Set<string>();

    for (const clip of [...clips].sort((a, b) => a.startUs - b.startUs)) {
      const sourceKey = clip.sourcePath;
      if (!sourceKey || selectedSources.has(sourceKey)) continue;
      selectedSources.add(sourceKey);
      selectedClips.push(clip);
      if (selectedClips.length >= maxClips) break;
    }

    let nextClipIndex = 0;
    const prefetchClip = async (clip: AudioEngineClip) => {
      const sourceKey = clip.sourcePath;
      if (!sourceKey) return;
      this.invalidateIfSourceHandleChanged(sourceKey, clip.fileHandle);

      const startOffsetS = clip.sourceStartUs / 1_000_000;
      const sourceEndS = startOffsetS + clip.sourceRangeDurationUs / 1_000_000;
      const startChunkIndex = this.getChunkIndex(startOffsetS);
      const lastChunkIndex = this.getChunkIndex(Math.max(startOffsetS, sourceEndS - 1e-6));

      const tasks: Array<Promise<AudioChunk | null>> = [];
      for (let offset = 0; offset < chunksAhead; offset += 1) {
        if (options?.shouldContinue?.() === false) return;

        const targetIndex = startChunkIndex + offset;
        if (targetIndex > lastChunkIndex) break;
        const chunkKey = this.getChunkKey(sourceKey, targetIndex);
        if (this.chunkCache.get(sourceKey)?.some((c) => c.chunkIndex === targetIndex)) continue;
        if (this.chunkDecodeInFlight.has(chunkKey)) continue;
        tasks.push(
          this.ensureDecoded({
            sourceKey,
            fileHandle: clip.fileHandle,
            chunkIndex: targetIndex,
          }),
        );
      }
      await Promise.all(tasks);
    };

    const worker = async () => {
      while (options?.shouldContinue?.() !== false) {
        const clip = selectedClips[nextClipIndex++];
        if (!clip) return;
        await prefetchClip(clip);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, selectedClips.length) }, () => worker()),
    );
  }

  cleanup(activeSourcePaths: Set<string>) {
    for (const key of this.chunkCache.keys()) {
      if (!activeSourcePaths.has(key)) {
        this.chunkCache.delete(key);
        for (const chunkKey of this.chunkLruKeys.keys()) {
          if (chunkKey.startsWith(`${key}\x00`)) {
            this.chunkLruKeys.delete(chunkKey);
          }
        }
      }
    }
    for (const key of this.failedChunkKeys) {
      const sourceKey = this.getSourceKeyFromChunkKey(key);
      if (!activeSourcePaths.has(sourceKey)) {
        this.failedChunkKeys.delete(key);
      }
    }
    for (const key of this.fileBlobCache.keys()) {
      if (!activeSourcePaths.has(key)) {
        this.fileBlobCache.delete(key);
      }
    }
    for (const key of this.sourceFileHandles.keys()) {
      if (!activeSourcePaths.has(key)) {
        this.sourceFileHandles.delete(key);
      }
    }
    for (const key of this.chunkRetryCounts.keys()) {
      const sourceKey = this.getSourceKeyFromChunkKey(key);
      if (!activeSourcePaths.has(sourceKey)) {
        this.chunkRetryCounts.delete(key);
      }
    }
  }

  async ensureDecoded(params: EnsureAudioChunkDecodedParams): Promise<AudioChunk | null> {
    const { sourceKey, fileHandle, chunkIndex } = params;
    this.invalidateIfSourceHandleChanged(sourceKey, fileHandle);
    const chunkKey = this.getChunkKey(sourceKey, chunkIndex);

    if (this.failedChunkKeys.has(chunkKey)) {
      return null;
    }

    const inFlight = this.chunkDecodeInFlight.get(chunkKey);
    if (inFlight) {
      return inFlight;
    }

    const existingChunks = this.chunkCache.get(sourceKey);
    if (existingChunks) {
      const cached = existingChunks.find((c) => c.chunkIndex === chunkIndex);
      if (cached) {
        this.touchLru(chunkKey);
        return cached;
      }
    }

    const task = this.decodeClient.withSlot(async () => {
      try {
        let blob = this.fileBlobCache.get(sourceKey);
        if (!blob) {
          blob = await withFileIoSlot(() => fileHandle.getFile());
          this.fileBlobCache.set(sourceKey, blob);
        }

        const ctx = this.getContext();
        if (!ctx) return null;

        const requestedStartTimeS = chunkIndex * this.chunkSizeS;
        const persistentCache = this.getPersistentCache();
        const cachedChunk = await readAudioChunkFromFileCache({
          ...persistentCache,
          sourceKey,
          chunkIndex,
          chunkSizeS: this.chunkSizeS,
          sourceFile: blob,
          context: ctx,
        });
        if (cachedChunk) {
          // The configured chunk size is the cursor-advancing extent; any buffer
          // content past it is the trailing crossfade overlap.
          const chunk: AudioChunk = { ...cachedChunk, nominalDurationS: this.chunkSizeS };
          this.addChunk(sourceKey, chunk, chunkKey);
          return chunk;
        }

        // Decode one seam-crossfade past the nominal chunk so the next chunk has
        // a shared-source region to crossfade in over, masking the per-chunk
        // decode-boundary discontinuity without dipping to silence.
        const decoded = await this.decodeClient.decodeRange(
          blob,
          sourceKey,
          requestedStartTimeS,
          this.chunkSizeS + SEAM_CROSSFADE_S,
        );

        if (!decoded?.channelBuffers?.length) {
          log.warn(`[AudioEngine] Worker returned null for chunk ${chunkKey}`);
          return null;
        }

        const numChannels = Math.max(1, Math.round(Number(decoded.numberOfChannels) || 1));
        const sampleRate = Math.max(8000, Math.round(Number(decoded.sampleRate) || 48000));
        const totalFrames = decoded.totalFrames ?? 0;

        if (totalFrames <= 0) {
          log.warn(`[AudioEngine] Decoded audio chunk has 0 frames for ${chunkKey}`);
          return null;
        }

        const audioBuffer = ctx.createBuffer(numChannels, totalFrames, sampleRate);
        for (let ch = 0; ch < numChannels; ch += 1) {
          const buf = decoded.channelBuffers[ch];
          if (!buf) continue;
          const data = new Float32Array(buf);
          audioBuffer.copyToChannel(data, ch, 0);
        }

        const chunk: AudioChunk = {
          chunkIndex,
          startTimeS: decoded.actualStartTimeS ?? requestedStartTimeS,
          durationS: totalFrames / sampleRate,
          nominalDurationS: this.chunkSizeS,
          buffer: audioBuffer,
        };

        this.addChunk(sourceKey, chunk, chunkKey);
        void writeAudioChunkToFileCache({
          ...persistentCache,
          sourceKey,
          chunkIndex,
          chunkSizeS: this.chunkSizeS,
          sourceFile: blob,
          chunk,
        }).catch((err) => {
          log.warn(`[AudioEngine] Failed to persist audio chunk ${chunkKey}`, err);
        });
        return chunk;
      } catch (err) {
        this.handleDecodeError({ err, chunkKey, sourceKey });
        return null;
      } finally {
        this.chunkDecodeInFlight.delete(chunkKey);
      }
    });

    this.chunkDecodeInFlight.set(chunkKey, task);
    return task;
  }

  async getForRange(params: GetAudioChunksForRangeParams): Promise<AudioChunk[]> {
    const { sourceKey, fileHandle, startTimeS, durationS } = params;
    if (durationS <= 0) return [];

    const startIndex = this.getChunkIndex(startTimeS);
    const rangeEndS = startTimeS + durationS;
    const endIndex = Math.max(startIndex, Math.ceil(rangeEndS / this.chunkSizeS) - 1);
    const requests: Promise<AudioChunk | null>[] = [];
    for (let i = startIndex; i <= endIndex; i += 1) {
      requests.push(this.ensureDecoded({ sourceKey, fileHandle, chunkIndex: i }));
    }

    const settled = await Promise.all(requests);
    return settled.filter((chunk): chunk is AudioChunk => chunk != null);
  }

  clear() {
    this.chunkCache.clear();
    this.chunkDecodeInFlight.clear();
    this.failedChunkKeys.clear();
    this.chunkRetryCounts.clear();
    this.chunkLruKeys.clear();
    this.fileBlobCache.clear();
    this.sourceFileHandles.clear();
  }

  destroy() {
    this.clear();
    this.decodeClient.destroy();
  }

  private getChunkKey(sourceKey: string, chunkIndex: number): string {
    // Use null char as separator — it cannot appear in file paths on any
    // filesystem, unlike ':' which collides with Windows drives and URLs.
    return `${sourceKey}\x00${chunkIndex}`;
  }

  private getSourceKeyFromChunkKey(chunkKey: string): string {
    return chunkKey.slice(0, chunkKey.lastIndexOf('\x00'));
  }

  private invalidateIfSourceHandleChanged(sourceKey: string, fileHandle: FileSystemFileHandle) {
    const previousHandle = this.sourceFileHandles.get(sourceKey);
    if (previousHandle === fileHandle) return;
    this.sourceFileHandles.set(sourceKey, fileHandle);
    if (previousHandle === undefined) return; // First time seeing this source — nothing to invalidate.

    this.chunkCache.delete(sourceKey);
    this.fileBlobCache.delete(sourceKey);
    for (const chunkKey of this.chunkLruKeys.keys()) {
      if (chunkKey.startsWith(`${sourceKey}\x00`)) {
        this.chunkLruKeys.delete(chunkKey);
      }
    }
    for (const chunkKey of [...this.failedChunkKeys]) {
      if (this.getSourceKeyFromChunkKey(chunkKey) === sourceKey) {
        this.failedChunkKeys.delete(chunkKey);
      }
    }
    for (const chunkKey of [...this.chunkRetryCounts.keys()]) {
      if (this.getSourceKeyFromChunkKey(chunkKey) === sourceKey) {
        this.chunkRetryCounts.delete(chunkKey);
      }
    }
  }

  private getPersistentCache(): { vfs: IFileSystemAdapter | null; cacheVfsPath: string | null } {
    if (!this.getVfs || !this.getCacheVfsPath) {
      return { vfs: null, cacheVfsPath: null };
    }
    try {
      return {
        vfs: this.getVfs(),
        cacheVfsPath: this.getCacheVfsPath(),
      };
    } catch (err) {
      log.warn('[AudioEngine] Failed to resolve audio chunk cache VFS path', err);
      return { vfs: null, cacheVfsPath: null };
    }
  }

  private touchLru(chunkKey: string) {
    this.chunkLruKeys.delete(chunkKey);
    this.chunkLruKeys.set(chunkKey, true);
  }

  private addChunk(sourceKey: string, chunk: AudioChunk, chunkKey: string) {
    let sourceChunks = this.chunkCache.get(sourceKey);
    if (!sourceChunks) {
      sourceChunks = [];
      this.chunkCache.set(sourceKey, sourceChunks);
    }
    sourceChunks.push(chunk);
    sourceChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    this.touchLru(chunkKey);
    this.evictOldestChunksIfNeeded();
  }

  private evictOldestChunksIfNeeded() {
    if (this.chunkLruKeys.size <= this.maxChunkCount) return;

    const pinned = this.collectPinnedBuffers();
    let scanned = 0;
    while (this.chunkLruKeys.size > this.maxChunkCount && scanned < this.chunkLruKeys.size) {
      const oldestKey = this.chunkLruKeys.keys().next().value;
      if (!oldestKey) break;
      scanned += 1;

      const colonIdx = oldestKey.lastIndexOf('\x00');
      if (colonIdx < 0) {
        this.chunkLruKeys.delete(oldestKey);
        continue;
      }

      const sourceKey = oldestKey.slice(0, colonIdx);
      const chunkIndex = parseInt(oldestKey.slice(colonIdx + 1), 10);
      const chunks = this.chunkCache.get(sourceKey);
      if (!chunks) {
        this.chunkLruKeys.delete(oldestKey);
        continue;
      }

      const idx = chunks.findIndex((c) => c.chunkIndex === chunkIndex);
      if (idx < 0) {
        this.chunkLruKeys.delete(oldestKey);
        continue;
      }

      const chunk = chunks[idx];
      if (chunk && pinned.has(chunk.buffer)) {
        this.chunkLruKeys.delete(oldestKey);
        this.chunkLruKeys.set(oldestKey, true);
        continue;
      }

      chunks.splice(idx, 1);
      if (chunks.length === 0) {
        this.chunkCache.delete(sourceKey);
      }
      this.chunkLruKeys.delete(oldestKey);
    }
  }

  private handleDecodeError(params: { err: unknown; chunkKey: string; sourceKey: string }) {
    const { err, chunkKey, sourceKey } = params;
    const name = (err as Error)?.name;
    const message = (err as Error)?.message || '';
    const isTransient = name === 'NotReadableError' || /network error/i.test(message);

    if (message === DECODE_CANCELLED_MESSAGE) {
      return;
    }

    if (name === 'NoAudioTrackError' || name === 'UnsupportedFormatError') {
      this.failedChunkKeys.add(chunkKey);
    } else if (isTransient) {
      const retries = (this.chunkRetryCounts.get(chunkKey) ?? 0) + 1;
      if (retries >= 3) {
        this.failedChunkKeys.add(chunkKey);
        this.chunkRetryCounts.delete(chunkKey);
        log.warn(
          `[AudioEngine] Chunk ${chunkKey} failed after ${retries} transient retries; marking as permanently failed`,
          err,
        );
      } else {
        this.chunkRetryCounts.set(chunkKey, retries);
        log.warn(
          `[AudioEngine] Failed to decode chunk ${chunkKey} (transient, retry ${retries}/3)`,
          err,
        );
      }
      this.fileBlobCache.delete(sourceKey);
    } else {
      log.warn(`[AudioEngine] Failed to decode chunk ${chunkKey}`, err);
      this.fileBlobCache.delete(sourceKey);
    }
  }
}
