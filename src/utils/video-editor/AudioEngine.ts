import { createDevLogger } from '~/utils/dev-logger';

import {
  getGainAtClipTime,
  normalizeBalance,
  normalizeGain,
  resolveEffectiveFadeDurationsSeconds,
} from '~/utils/audio/envelope';
import { AudioGraphBuilder } from '~/utils/video-editor/AudioGraphBuilder';
import { AudioScheduler } from '~/utils/video-editor/AudioScheduler';

import type { DecodeRequest, DecodeResponse } from '~/utils/audio/types';
import type {
  AudioChunk,
  AudioEngineClip,
  AudioNodeCollection,
  ClipPlaybackWindow,
} from '~/utils/video-editor/audio-engine.types';

export type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';

const logger = createDevLogger('AudioEngine');

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private readonly chunkSizeS = 5;
  // Holds enough decoded PCM for multi-clip projects: each active clip pins
  // ~SCHEDULING_LOOKAHEAD_S / chunkSizeS chunks while playing; this limit
  // gives ample headroom on top of that and only kicks in for unusually
  // large timelines.
  private readonly maxChunkCount = 100;
  // How far ahead (in AudioContext seconds) the streaming loop is allowed to
  // pre-schedule source nodes for a given clip. Bigger = more decoder slack
  // (resilient to slow decodes) but more pinned AudioBuffers in memory.
  // 30s = up to ~6 chunks/clip in flight, ~12 MB stereo float32.
  private readonly schedulingLookaheadS = 30;
  private chunkCache = new Map<string, AudioChunk[]>();
  private chunkDecodeInFlight = new Map<string, Promise<AudioChunk | null>>();
  private failedChunkKeys = new Set<string>();
  private chunkLruKeys = new Map<string, true>();
  private fileBlobCache = new Map<string, Blob>();
  private activeNodes = new Set<AudioBufferSourceNode>();
  private activeCleanups = new Map<AudioBufferSourceNode, () => void>();
  private activeScrubNodes = new Set<AudioBufferSourceNode>();
  private activeScrubCleanups = new Map<AudioBufferSourceNode, () => void>();
  private masterGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private currentClips: AudioEngineClip[] = [];
  private readonly activePlaybackCollection: AudioNodeCollection = {
    nodes: this.activeNodes,
    cleanups: this.activeCleanups,
  };
  private readonly activeScrubCollection: AudioNodeCollection = {
    nodes: this.activeScrubNodes,
    cleanups: this.activeScrubCleanups,
  };
  private readonly graphBuilder = new AudioGraphBuilder();
  private readonly scheduler = new AudioScheduler({
    getContext: () => this.ctx,
    onScheduleLookahead: () => this.scheduleLookahead(),
    onStopNodes: () => this.stopAllNodes(),
  });

  private decodeWorker: Worker | null = null;
  private decodeCallId = 0;
  private decodePending = new Map<number, { resolve: Function; reject: Function }>();
  private decodeQueue: Array<() => void> = [];
  private decodeInFlightCount = 0;
  private readonly maxDecodeConcurrency = 2;
  private currentMasterVolume = 1;
  private currentMonitorVolume = 1;
  private schedulingClipIds = new Set<string>();
  private scheduleGeneration = 0;

  private analyserNodes = new Map<string, AnalyserNode>(); // map by trackId or "master"
  private analyserData = new Float32Array(2048);

  constructor() {}

  private ensureDecodeWorker() {
    if (this.decodeWorker) return this.decodeWorker;

    const worker = new Worker(new URL('../../workers/audio-decode.worker.ts', import.meta.url), {
      type: 'module',
      name: 'audio-decode',
    });

    worker.addEventListener('message', (event: MessageEvent<DecodeResponse>) => {
      const data = event.data;
      if (!data || data.type !== 'decode-result') return;
      const pending = this.decodePending.get(data.id);
      if (!pending) return;
      this.decodePending.delete(data.id);

      if (!data.ok) {
        const err = new Error(data.error?.message || 'Audio decode failed');
        if (data.error?.name) (err as any).name = data.error.name;
        if (data.error?.stack) (err as any).stack = data.error.stack;
        pending.reject(err);
        return;
      }

      pending.resolve(data.result);
    });

    worker.addEventListener('error', (event) => {
      console.error('[AudioEngine] Decode worker error', event);
      for (const [, pending] of this.decodePending.entries()) {
        pending.reject(new Error('Audio decode worker crashed'));
      }
      this.decodePending.clear();
      this.decodeWorker = null;
    });

    this.decodeWorker = worker;
    return worker;
  }

  private extractPeaksInWorker(
    blob: Blob,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ) {
    const worker = this.ensureDecodeWorker();
    return new Promise<DecodeResponse['result']>((resolve, reject) => {
      const id = ++this.decodeCallId;
      this.decodePending.set(id, { resolve, reject });
      const req: DecodeRequest = { type: 'extract-peaks', id, sourceKey, blob, options };
      worker.postMessage(req);
    });
  }

  private decodeInWorker(arrayBuffer: ArrayBuffer, sourceKey: string) {
    const worker = this.ensureDecodeWorker();
    return new Promise<DecodeResponse['result']>((resolve, reject) => {
      const id = ++this.decodeCallId;
      this.decodePending.set(id, { resolve, reject });
      const req: DecodeRequest = { type: 'decode', id, sourceKey, arrayBuffer };
      worker.postMessage(req, [arrayBuffer]);
    });
  }

  private decodeRangeInWorker(
    source: Blob | ArrayBuffer,
    sourceKey: string,
    startTimeS: number,
    durationS: number,
  ) {
    const worker = this.ensureDecodeWorker();
    return new Promise<DecodeResponse['result']>((resolve, reject) => {
      const id = ++this.decodeCallId;
      this.decodePending.set(id, { resolve, reject });
      const req: DecodeRequest = {
        type: 'decode-range',
        id,
        sourceKey,
        startTimeS,
        durationS,
      };
      if (source instanceof ArrayBuffer) {
        req.arrayBuffer = source;
        worker.postMessage(req, [source]);
      } else {
        req.blob = source;
        worker.postMessage(req);
      }
    });
  }

  private async withDecodeSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.decodeInFlightCount >= this.maxDecodeConcurrency) {
      await new Promise<void>((resolve) => this.decodeQueue.push(resolve));
    }
    this.decodeInFlightCount += 1;
    try {
      return await task();
    } finally {
      this.decodeInFlightCount = Math.max(0, this.decodeInFlightCount - 1);
      const next = this.decodeQueue.shift();
      if (next) next();
    }
  }

  private getChunkIndex(timeS: number): number {
    return Math.floor(timeS / this.chunkSizeS);
  }

  private getChunkKey(sourceKey: string, chunkIndex: number): string {
    return `${sourceKey}:${chunkIndex}`;
  }

  private touchLru(chunkKey: string) {
    this.chunkLruKeys.delete(chunkKey);
    this.chunkLruKeys.set(chunkKey, true);
  }

  private collectPinnedBuffers(): Set<AudioBuffer> {
    const pinned = new Set<AudioBuffer>();
    for (const node of this.activeNodes) {
      if (node.buffer) pinned.add(node.buffer);
    }
    for (const node of this.activeScrubNodes) {
      if (node.buffer) pinned.add(node.buffer);
    }
    return pinned;
  }

  private evictOldestChunksIfNeeded() {
    if (this.chunkLruKeys.size <= this.maxChunkCount) return;

    const pinned = this.collectPinnedBuffers();
    let scanned = 0;
    while (this.chunkLruKeys.size > this.maxChunkCount && scanned < this.chunkLruKeys.size) {
      const oldestKey = this.chunkLruKeys.keys().next().value;
      if (!oldestKey) break;
      scanned += 1;

      const colonIdx = oldestKey.lastIndexOf(':');
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

  public async extractPeaks(
    fileHandle: FileSystemFileHandle,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ): Promise<Float32Array[] | null> {
    const task = this.withDecodeSlot(async () => {
      try {
        const file = await fileHandle.getFile();

        const decoded = await this.extractPeaksInWorker(file, sourceKey, options);
        if (!decoded || !decoded.peaks) {
          console.warn(`[AudioEngine] Failed to extract peaks for ${sourceKey}`);
          return null;
        }

        return decoded.peaks;
      } catch (err) {
        console.warn(`[AudioEngine] Failed to extract peaks for ${sourceKey}`, err);
        return null;
      }
    });

    return task;
  }

  async init(options?: { sampleRate?: number; audioChannels?: 'stereo' | 'mono' }) {
    const sampleRate = options?.sampleRate || 48000;
    const channelCount = options?.audioChannels === 'mono' ? 1 : 2;

    if (this.ctx && this.ctx.sampleRate !== sampleRate) {
      void this.ctx.close();
      this.ctx = null;
    }

    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.currentMasterVolume;

      this.monitorGain = this.ctx.createGain();
      this.monitorGain.gain.value = this.currentMonitorVolume;

      const masterAnalyser = this.ctx.createAnalyser();
      masterAnalyser.fftSize = 2048;

      // Chain: MasterGain -> Analyser -> MonitorGain -> Destination
      this.masterGain.connect(masterAnalyser);
      masterAnalyser.connect(this.monitorGain);
      this.monitorGain.connect(this.ctx.destination);

      this.analyserNodes.set('master', masterAnalyser);

      this.setDestinationChannelCount(channelCount);
    } else {
      if (this.ctx.destination && this.ctx.destination.channelCount !== channelCount) {
        this.setDestinationChannelCount(channelCount);
      }
    }
  }

  private setDestinationChannelCount(channelCount: number) {
    // Some browsers expose `destination.channelCount` as read-only or clamp it
    // to `maxChannelCount`. Swallow the failure: the audio still plays — at
    // worst, channel routing is up to the browser's default mixer.
    if (!this.ctx?.destination) return;
    try {
      this.ctx.destination.channelCount = channelCount;
    } catch (err) {
      console.warn('[AudioEngine] Failed to set destination channelCount', err);
    }
  }

  async resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch((err) => {
        console.warn('[AudioEngine] resumeContext: Failed to resume', err);
      });
    }
  }

  async loadClips(clips: AudioEngineClip[]) {
    logger.info(
      'loadClips',
      clips.map((c) => ({
        id: c.id,
        startUs: c.startUs,
        durationUs: c.durationUs,
        sourceStartUs: c.sourceStartUs,
        sourceRangeDurationUs: c.sourceRangeDurationUs,
        sourceDurationUs: c.sourceDurationUs,
      })),
    );
    this.currentClips = clips;
    this.cleanupCache();
    await this.prefetchHeadChunks(clips);
  }

  private async prefetchHeadChunks(clips: AudioEngineClip[]) {
    // Best-effort warm-up: decode the first two chunks of every clip so the
    // scheduler doesn't have to wait on the decode worker the moment playback
    // starts. Clamps to the clip's source range so we don't ask for data that
    // isn't part of the clip. Yields between launches so we don't block the UI.
    const chunksAhead = 2;
    for (const clip of clips) {
      const sourceKey = clip.sourcePath;
      if (!sourceKey) continue;

      const startOffsetS = clip.sourceStartUs / 1_000_000;
      const sourceEndS = startOffsetS + clip.sourceRangeDurationUs / 1_000_000;
      const startChunkIndex = this.getChunkIndex(startOffsetS);
      const lastChunkIndex = this.getChunkIndex(Math.max(startOffsetS, sourceEndS - 1e-6));
      for (let offset = 0; offset < chunksAhead; offset += 1) {
        const targetIndex = startChunkIndex + offset;
        if (targetIndex > lastChunkIndex) break;
        const chunkKey = this.getChunkKey(sourceKey, targetIndex);
        if (this.chunkCache.get(sourceKey)?.some((c) => c.chunkIndex === targetIndex)) continue;
        if (this.chunkDecodeInFlight.has(chunkKey)) continue;
        void this.ensureChunkDecoded(sourceKey, clip.fileHandle, targetIndex);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  updateTimelineLayout(clips: AudioEngineClip[]) {
    this.currentClips = clips;
    this.cleanupCache();
    void this.prefetchHeadChunks(clips);
    if (this.scheduler.isPlayingActive()) {
      // Re-evaluate playing nodes
      const currentTimeUs = this.getCurrentTimeUs();
      this.stopAllNodes();
      this.scheduler.resetScheduledClips();
      void this.play(currentTimeUs, this.scheduler.getGlobalSpeed());
    }
  }

  private cleanupCache() {
    const activePaths = new Set(this.currentClips.map((c) => c.sourcePath).filter(Boolean));
    for (const key of this.chunkCache.keys()) {
      if (!activePaths.has(key)) {
        this.chunkCache.delete(key);
        for (const chunkKey of this.chunkLruKeys.keys()) {
          if (chunkKey.startsWith(`${key}:`)) {
            this.chunkLruKeys.delete(chunkKey);
          }
        }
      }
    }
    for (const key of this.failedChunkKeys) {
      const sourceKey = key.slice(0, key.lastIndexOf(':'));
      if (!activePaths.has(sourceKey)) {
        this.failedChunkKeys.delete(key);
      }
    }
    for (const key of this.fileBlobCache.keys()) {
      if (!activePaths.has(key)) {
        this.fileBlobCache.delete(key);
      }
    }
    this.cleanupAnalyserNodes();
  }

  private cleanupAnalyserNodes() {
    const activeTrackIds = new Set(
      this.currentClips
        .map((clip) => clip.trackId)
        .filter((trackId): trackId is string => !!trackId),
    );
    for (const [id, analyser] of this.analyserNodes) {
      if (id === 'master' || activeTrackIds.has(id)) continue;
      try {
        analyser.disconnect();
      } catch {
        /* no-op */
      }
      this.analyserNodes.delete(id);
    }
  }

  getLevels(trackId?: string): { rmsDb: number; peakDb: number } {
    if (!this.ctx || !this.scheduler.isPlayingActive()) return { rmsDb: -60, peakDb: -60 };

    const id = trackId || 'master';
    const analyser = this.analyserNodes.get(id);
    if (!analyser) {
      return { rmsDb: -60, peakDb: -60 };
    }

    analyser.getFloatTimeDomainData(this.analyserData);

    let sumSquares = 0;
    let peak = 0;
    let count = 0;
    const len = this.analyserData.length;
    for (let i = 0; i < len; i++) {
      const val = this.analyserData[i];
      if (val === undefined || !Number.isFinite(val)) continue;
      const abs = Math.abs(val);
      sumSquares += abs * abs;
      if (abs > peak) peak = abs;
      count += 1;
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;

    return {
      rmsDb: rms > 0.001 ? 20 * Math.log10(rms) : -60,
      peakDb: peak > 0.001 ? 20 * Math.log10(peak) : -60,
    };
  }

  private async ensureChunkDecoded(
    sourceKey: string,
    fileHandle: FileSystemFileHandle,
    chunkIndex: number,
  ): Promise<AudioChunk | null> {
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

    const task = this.withDecodeSlot(async () => {
      try {
        let blob = this.fileBlobCache.get(sourceKey);
        if (!blob) {
          blob = await fileHandle.getFile();
          this.fileBlobCache.set(sourceKey, blob);
        }
        if (!this.ctx) return null;

        const requestedStartTimeS = chunkIndex * this.chunkSizeS;
        const decoded = await this.decodeRangeInWorker(
          blob,
          sourceKey,
          requestedStartTimeS,
          this.chunkSizeS,
        );

        if (!decoded || !decoded.channelBuffers?.length) {
          console.warn(`[AudioEngine] Worker returned null for chunk ${chunkKey}`);
          return null;
        }

        const numChannels = Math.max(1, Math.round(Number(decoded.numberOfChannels) || 1));
        const sampleRate = Math.max(8000, Math.round(Number(decoded.sampleRate) || 48000));
        const totalFrames = decoded.totalFrames ?? 0;

        if (totalFrames <= 0) {
          console.warn(`[AudioEngine] Decoded audio chunk has 0 frames for ${chunkKey}`);
          return null;
        }

        const audioBuffer = this.ctx.createBuffer(numChannels, totalFrames, sampleRate);
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
          buffer: audioBuffer,
        };

        let sourceChunks = this.chunkCache.get(sourceKey);
        if (!sourceChunks) {
          sourceChunks = [];
          this.chunkCache.set(sourceKey, sourceChunks);
        }
        sourceChunks.push(chunk);
        sourceChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

        this.touchLru(chunkKey);
        this.evictOldestChunksIfNeeded();

        // logger.info(
        //   `Decoded chunk ${chunkKey}: ${numChannels}ch, ${sampleRate}Hz, ${totalFrames} frames`,
        // );
        return chunk;
      } catch (err) {
        const name = (err as any)?.name;
        // Only permanent failures should block retries. Transient errors
        // (e.g. blob read interrupted) deserve another shot the next time the
        // chunk is requested.
        if (name === 'NoAudioTrackError' || name === 'UnsupportedFormatError') {
          this.failedChunkKeys.add(chunkKey);
        } else {
          console.warn(`[AudioEngine] Failed to decode chunk ${chunkKey}`, err);
          // Drop the cached blob so the next retry fetches a fresh snapshot.
          // This fixes stale reads after the underlying OPFS/Tauri file is
          // regenerated or modified.
          this.fileBlobCache.delete(sourceKey);
        }
        return null;
      } finally {
        this.chunkDecodeInFlight.delete(chunkKey);
      }
    });

    this.chunkDecodeInFlight.set(chunkKey, task);
    return task;
  }

  private async getChunksForRange(
    sourceKey: string,
    fileHandle: FileSystemFileHandle,
    startTimeS: number,
    durationS: number,
  ): Promise<AudioChunk[]> {
    if (durationS <= 0) return [];

    const startIndex = this.getChunkIndex(startTimeS);
    const endIndex = this.getChunkIndex(startTimeS + durationS);

    const requests: Promise<AudioChunk | null>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      requests.push(this.ensureChunkDecoded(sourceKey, fileHandle, i));
    }

    // Concurrency is still bounded by withDecodeSlot; Promise.all just lets
    // the worker pick up the next index as soon as a slot frees up.
    const settled = await Promise.all(requests);
    return settled.filter((chunk): chunk is AudioChunk => chunk != null);
  }

  private async getDecodedChunks(clip: AudioEngineClip): Promise<AudioChunk[]> {
    const sourceKey = clip.sourcePath;
    if (!sourceKey) return [];

    const startOffsetS = clip.sourceStartUs / 1_000_000;
    const durationS = clip.sourceRangeDurationUs / 1_000_000;

    return this.getChunksForRange(sourceKey, clip.fileHandle, startOffsetS, durationS);
  }

  private buildClipPlaybackWindow(clip: AudioEngineClip, currentTimeS: number, speed: number) {
    const clipDurationS = clip.durationUs / 1_000_000;
    const speedRaw = clip.speed;

    const clipSpeed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
        ? Math.min(10, Math.abs(speedRaw))
        : 1;
    const reversed = typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw < 0;
    const effectiveSpeed = clipSpeed * speed;

    if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) {
      return null;
    }

    // Audio is not rendered for clips with negative speed (reversed playback).
    // Reversing PCM produces aliasing and breaks stateful effects; skipping
    // keeps preview/export aligned with the explicit product decision.
    if (reversed) {
      return null;
    }

    const { previousClip, nextClip } = this.getAdjacentClips(clip);
    const { fadeInS, fadeOutS, fadeInCurve, fadeOutCurve } = resolveEffectiveFadeDurationsSeconds({
      clipDurationS,
      clip,
      previousClip,
      nextClip,
      defaultAudioFadeCurve: clip.defaultAudioFadeCurve,
    });

    const audioGain = normalizeGain(clip.audioGain, 1);
    const audioBalance = normalizeBalance(clip.audioBalance, 0);

    let effectivePlayDurationS = clipDurationS;
    let effectiveStartUs = clip.startUs;
    let effectiveSourceStartUs = clip.sourceStartUs;

    if (
      clip.transitionOut?.durationUs &&
      Number(clip.transitionOut.durationUs) > 0 &&
      clip.transitionOut.mode === 'adjacent'
    ) {
      effectivePlayDurationS += Number(clip.transitionOut.durationUs) / 1_000_000;
    }

    if (
      clip.transitionIn?.durationUs &&
      Number(clip.transitionIn.durationUs) > 0 &&
      clip.transitionIn.mode === 'adjacent'
    ) {
      effectivePlayDurationS += Number(clip.transitionIn.durationUs) / 1_000_000;
      effectiveStartUs = Math.max(0, clip.startUs - Number(clip.transitionIn.durationUs));
      effectiveSourceStartUs = Math.max(
        0,
        clip.sourceStartUs - Number(clip.transitionIn.durationUs) * clipSpeed,
      );
    }

    const effectiveStartS = effectiveStartUs / 1_000_000;
    const effectiveSourceStartS = effectiveSourceStartUs / 1_000_000;
    const effectiveSourceEndS = effectiveSourceStartS + effectivePlayDurationS * clipSpeed;
    const currentClipLocalS = Math.max(0, currentTimeS - effectiveStartS);
    const remainingInClipS = Math.max(0, effectivePlayDurationS - currentClipLocalS);

    if (remainingInClipS <= 0) {
      return null;
    }

    return {
      currentTimeS,
      startAtS: this.ctx?.currentTime ?? 0,
      currentClipLocalS,
      remainingInClipS,
      effectiveStartS,
      effectiveSourceStartS,
      effectiveSourceEndS,
      clipDurationS,
      clipSpeed,
      reversed,
      fadeInS,
      fadeOutS,
      fadeInCurve,
      fadeOutCurve,
      audioGain,
      audioBalance,
      effectiveSpeed,
      globalSpeed: speed,
    } satisfies ClipPlaybackWindow;
  }

  private async playClipSegment(
    clip: AudioEngineClip,
    chunks: AudioChunk[],
    window: ClipPlaybackWindow,
    options?: {
      maxPlaybackDurationS?: number;
      nodeSet?: Set<AudioBufferSourceNode>;
      cleanupMap?: Map<AudioBufferSourceNode, () => void>;
      requirePlayingActive?: boolean;
    },
  ) {
    if (!this.ctx || !this.masterGain || chunks.length === 0) return;
    if (options?.requirePlayingActive && !this.scheduler.isPlayingActive()) return;

    const currentSourceTimeS = this.getSourceTimeForClipLocal(window, window.currentClipLocalS);

    let safeBufferOffsetS = currentSourceTimeS;
    let safeDurationToPlayS = window.remainingInClipS * window.clipSpeed;

    if (typeof options?.maxPlaybackDurationS === 'number' && options.maxPlaybackDurationS > 0) {
      safeDurationToPlayS = Math.min(safeDurationToPlayS, options.maxPlaybackDurationS);
    }

    if (!Number.isFinite(safeBufferOffsetS) || safeBufferOffsetS < 0) {
      safeBufferOffsetS = 0;
    }

    const sampleRate = Math.max(1, Math.round(chunks[0]?.buffer?.sampleRate || 48000));
    const epsilon = 1 / sampleRate;

    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];
    const minSourceTimeS = firstChunk ? firstChunk.startTimeS : 0;
    const maxSourceTimeS = lastChunk ? lastChunk.startTimeS + lastChunk.durationS : 0;

    if (safeBufferOffsetS >= maxSourceTimeS) {
      safeBufferOffsetS = Math.max(0, maxSourceTimeS - epsilon);
    }

    const remainingInBufferS = Math.max(
      0,
      maxSourceTimeS - Math.max(safeBufferOffsetS, minSourceTimeS),
    );
    safeDurationToPlayS = Math.min(
      Math.max(safeDurationToPlayS, epsilon),
      Math.max(remainingInBufferS, epsilon),
    );

    if (!Number.isFinite(safeDurationToPlayS) || safeDurationToPlayS <= 0) {
      return;
    }

    // Create a single clip input node that all chunk sources feed into.
    // The graph builder wires effects and panner from this node to clipGain.
    const clipInputNode = this.ctx.createGain();
    const clipGain = this.ctx.createGain();

    const { destroy: destroyEffects } = this.graphBuilder.buildClipGraph({
      audioContext: this.ctx,
      sourceNode: clipInputNode,
      audioBalance: window.audioBalance,
      effects: clip.audioEffects ?? [],
      clipGain,
      masterGain: this.masterGain,
      trackId: clip.trackId,
      analyserNodes: this.analyserNodes,
    });

    const startAtS = window.startAtS;
    const playedClipDurationS = safeDurationToPlayS / window.effectiveSpeed;
    const endAtS = startAtS + playedClipDurationS;

    function gainAtClipTime(tClipS: number): number {
      return getGainAtClipTime({
        clipDurationS: window.clipDurationS,
        fadeInS: window.fadeInS,
        fadeOutS: window.fadeOutS,
        fadeInCurve: window.fadeInCurve,
        fadeOutCurve: window.fadeOutCurve,
        baseGain: window.audioGain,
        tClipS,
      });
    }

    // Clip-local time advances at globalSpeed per wall-clock second, regardless
    // of the per-clip speed (that's already folded into playbackRate).
    const globalSpeed = Math.max(1e-9, window.globalSpeed);
    const clipLocalToCtxS = (tClipS: number) =>
      startAtS + (tClipS - window.currentClipLocalS) / globalSpeed;

    const t0 = window.currentClipLocalS;
    const t1 = window.currentClipLocalS + window.remainingInClipS;
    const gainParam: any = clipGain.gain;

    gainParam.cancelScheduledValues?.(this.ctx.currentTime);
    gainParam.setValueAtTime?.(gainAtClipTime(t0), startAtS);

    if (window.fadeInS > 0 && t0 < window.fadeInS && t1 > 0) {
      const rampEndClipS = Math.min(window.fadeInS, t1);
      const rampEndAtS = clipLocalToCtxS(rampEndClipS);
      this.scheduleGainCurve({
        gainParam,
        startClipS: t0,
        endClipS: rampEndClipS,
        startAtS,
        endAtS: rampEndAtS,
        getGainAtClipTime: gainAtClipTime,
      });
    }

    const outStartClipS = window.clipDurationS - window.fadeOutS;
    if (window.fadeOutS > 0 && t1 > outStartClipS) {
      const rampStartClipS = Math.max(outStartClipS, t0);
      const rampStartAtS = clipLocalToCtxS(rampStartClipS);
      gainParam.setValueAtTime?.(gainAtClipTime(rampStartClipS), rampStartAtS);
      this.scheduleGainCurve({
        gainParam,
        startClipS: rampStartClipS,
        endClipS: t1,
        startAtS: rampStartAtS,
        endAtS: Math.max(rampStartAtS, endAtS),
        getGainAtClipTime: gainAtClipTime,
      });
    }

    let scheduledTimeS = startAtS;
    let remainingToPlayS = safeDurationToPlayS;
    let currentOffsetS = safeBufferOffsetS;
    const chunkNodes: AudioBufferSourceNode[] = [];

    for (const chunk of chunks) {
      if (remainingToPlayS <= 0) break;

      const chunkStartS = chunk.startTimeS;
      const chunkEndS = chunk.startTimeS + chunk.durationS;

      if (currentOffsetS >= chunkEndS) continue;

      const offsetInChunkS = Math.max(0, currentOffsetS - chunkStartS);
      const availableInChunkS = chunk.durationS - offsetInChunkS;
      const playDurationS = Math.min(remainingToPlayS, availableInChunkS);

      if (playDurationS <= 0) continue;

      const sourceNode = this.ctx.createBufferSource();

      sourceNode.buffer = chunk.buffer;
      if (sourceNode.playbackRate) {
        sourceNode.playbackRate.value = window.effectiveSpeed;
      }

      sourceNode.connect(clipInputNode);

      const actualPlayDurationS = playDurationS / window.effectiveSpeed;
      sourceNode.start(scheduledTimeS, offsetInChunkS, playDurationS);

      chunkNodes.push(sourceNode);

      scheduledTimeS += actualPlayDurationS;
      remainingToPlayS -= playDurationS;
      currentOffsetS += playDurationS;
    }

    const targetNodeSet = options?.nodeSet ?? this.activePlaybackCollection.nodes;
    const targetCleanupMap = options?.cleanupMap ?? this.activePlaybackCollection.cleanups;

    const cleanupAll = () => {
      destroyEffects();
      try {
        clipInputNode.disconnect();
      } catch {
        /* no-op */
      }
      try {
        clipGain.disconnect();
      } catch {
        /* no-op */
      }
      for (const node of chunkNodes) {
        targetNodeSet.delete(node);
        try {
          node.disconnect();
        } catch {
          /* no-op */
        }
      }
    };

    if (chunkNodes.length === 0) {
      cleanupAll();
      return;
    }

    const lastIndex = chunkNodes.length - 1;
    for (let i = 0; i < chunkNodes.length; i++) {
      const node = chunkNodes[i];
      if (!node) continue;
      targetNodeSet.add(node);

      node.onended = () => {
        targetNodeSet.delete(node);
        if (i === lastIndex) {
          cleanupAll();
        }
      };
    }

    const lastNode = chunkNodes[lastIndex];
    if (lastNode) {
      targetCleanupMap.set(lastNode, cleanupAll);
    }
  }

  private scheduleLookahead() {
    if (!this.scheduler.isPlayingActive() || this.scheduler.getGlobalSpeed() <= 0) return;
    const LOOKAHEAD_S = 0.5;
    const currentS = this.getCurrentTimeS();
    const endS = currentS + LOOKAHEAD_S;

    for (const clip of this.currentClips) {
      if (this.scheduler.hasScheduledClip(clip.id)) continue;
      if (this.schedulingClipIds.has(clip.id)) continue;

      const clipStartS = clip.startUs / 1_000_000;
      const clipEndS = clipStartS + clip.durationUs / 1_000_000;

      if (clipStartS <= endS && clipEndS >= currentS) {
        const generation = this.scheduleGeneration;
        this.schedulingClipIds.add(clip.id);
        void this.scheduleClip(clip, generation)
          .then((scheduled) => {
            if (scheduled) {
              this.scheduler.markClipScheduled(clip.id);
            }
          })
          .finally(() => {
            this.schedulingClipIds.delete(clip.id);
          });
      }
    }
  }

  async play(timeUs: number, speed = 1) {
    this.scheduleGeneration += 1;
    const generation = this.scheduleGeneration;
    this.schedulingClipIds.clear();
    this.stopScrubPreview();

    // Resume the context before decoding so createBuffer() is available; this
    // can take ~100ms on Safari/iOS, hence we do it before measuring kickoff.
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume().catch((err) => {
        console.warn('[AudioEngine] play: Failed to resume AudioContext', err);
      });
    }

    // Synchronously decode the chunk(s) under the playhead for every clip
    // currently overlapping `timeUs`, so the first source nodes can be
    // scheduled the moment scheduler.play() returns.
    await this.prepareForPlayback(timeUs);

    // Bail out if the user pressed Stop while we were awaiting decode.
    if (generation !== this.scheduleGeneration) return;

    await this.scheduler.play(timeUs, speed);
  }

  private async prepareForPlayback(timeUs: number): Promise<void> {
    if (!this.ctx) return;

    const timeS = timeUs / 1_000_000;
    const LOOKAHEAD_S = 0.5;
    const windowEndS = timeS + LOOKAHEAD_S;

    const activeClips = this.currentClips.filter((clip) => {
      // Reversed clips don't emit audio (see buildClipPlaybackWindow); skip
      // their decode entirely so we don't pin chunks that won't be used.
      if (this.isReversedClip(clip)) return false;
      const startS = clip.startUs / 1_000_000;
      const endS = startS + clip.durationUs / 1_000_000;
      return endS > timeS && startS <= windowEndS;
    });

    if (activeClips.length === 0) return;

    const decodes = activeClips.map(async (clip) => {
      const sourceKey = clip.sourcePath;
      if (!sourceKey) return;

      const clipStartS = clip.startUs / 1_000_000;
      const clipLocalS = Math.max(0, timeS - clipStartS);
      const clipSpeed =
        typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed !== 0
          ? Math.min(10, Math.abs(clip.speed))
          : 1;
      const sourceStartS = clip.sourceStartUs / 1_000_000;
      const sourceTimeS = sourceStartS + clipLocalS * clipSpeed;
      // Decode every chunk that overlaps the kickoff lookahead window so the
      // streamer never blocks on the first chunk boundary right after play().
      const sourceEndS = sourceTimeS + LOOKAHEAD_S * clipSpeed;
      const startChunkIndex = this.getChunkIndex(sourceTimeS);
      const endChunkIndex = this.getChunkIndex(Math.max(sourceTimeS, sourceEndS));
      const tasks: Array<Promise<unknown>> = [];
      for (let i = startChunkIndex; i <= endChunkIndex; i += 1) {
        tasks.push(this.ensureChunkDecoded(sourceKey, clip.fileHandle, i));
      }
      await Promise.all(tasks);
    });

    await Promise.all(decodes);
  }

  private isReversedClip(clip: AudioEngineClip): boolean {
    return typeof clip.speed === 'number' && Number.isFinite(clip.speed) && clip.speed < 0;
  }

  stop() {
    this.scheduleGeneration += 1;
    this.schedulingClipIds.clear();
    this.stopScrubPreview();
    this.scheduler.stop();
  }

  async previewScrubForward(fromUs: number, toUs: number, maxPreviewDurationUs = 90_000) {
    if (this.scheduler.isPlayingActive() || !this.ctx || !this.masterGain) {
      return;
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch((err) => {
        console.warn('[AudioEngine] previewScrubForward: Failed to resume AudioContext', err);
      });
    }

    const normalizedFromUs = Math.max(0, Math.round(fromUs));
    const normalizedToUs = Math.max(normalizedFromUs, Math.round(toUs));
    const windowUs = normalizedToUs - normalizedFromUs;
    const previewDurationUs = Math.min(windowUs, Math.max(1, Math.round(maxPreviewDurationUs)));

    if (previewDurationUs <= 0) {
      return;
    }

    this.stopScrubPreview();

    const previewStartS = normalizedFromUs / 1_000_000;
    const previewEndS = normalizedToUs / 1_000_000;
    const maxPlaybackDurationS = previewDurationUs / 1_000_000;

    for (const clip of this.currentClips) {
      const clipStartS = clip.startUs / 1_000_000;
      const clipEndS = clipStartS + clip.durationUs / 1_000_000;

      if (clipEndS <= previewStartS || clipStartS >= previewEndS) {
        continue;
      }

      const chunks = await this.getDecodedChunks(clip);
      if (chunks.length === 0) {
        continue;
      }

      const window = this.buildClipPlaybackWindow(clip, previewStartS, 1);
      if (!window) {
        continue;
      }

      const clippedDurationS = Math.min(window.remainingInClipS, maxPlaybackDurationS);
      if (clippedDurationS <= 0) {
        continue;
      }

      await this.playClipSegment(
        clip,
        chunks,
        { ...window, remainingInClipS: clippedDurationS },
        {
          maxPlaybackDurationS,
          nodeSet: this.activeScrubCollection.nodes,
          cleanupMap: this.activeScrubCollection.cleanups,
        },
      );
    }
  }

  stopScrubPreview() {
    this.stopNodeCollection(this.activeScrubNodes, this.activeScrubCleanups);
  }

  setGlobalSpeed(speed: number) {
    this.scheduleGeneration += 1;
    this.schedulingClipIds.clear();
    this.scheduler.setGlobalSpeed(speed);
  }

  seek(timeUs: number) {
    this.scheduleGeneration += 1;
    this.schedulingClipIds.clear();
    this.scheduler.seek(timeUs);
  }

  setVolume(volume: number) {
    this.setMasterVolume(volume);
  }

  setMasterVolume(volume: number) {
    this.currentMasterVolume = Math.max(0, Math.min(10, volume));
    if (this.masterGain) {
      const gain = this.masterGain.gain as AudioParam & {
        setTargetAtTime?: (target: number, startTime: number, timeConstant: number) => AudioParam;
      };
      if (this.ctx && typeof gain.setTargetAtTime === 'function') {
        gain.setTargetAtTime(this.currentMasterVolume, this.ctx.currentTime, 0.02);
      } else {
        gain.value = this.currentMasterVolume;
      }
    }
  }

  setMonitorVolume(volume: number) {
    this.currentMonitorVolume = Math.max(0, Math.min(10, volume));
    if (this.monitorGain) {
      this.monitorGain.gain.value = this.currentMonitorVolume;
    }
  }

  getCurrentTimeS(): number {
    return this.scheduler.getCurrentTimeS();
  }

  getCurrentTimeUs(): number {
    const s = this.getCurrentTimeS();
    return Math.round(s * 1_000_000);
  }

  private getAdjacentClips(clip: AudioEngineClip): {
    previousClip: AudioEngineClip | null;
    nextClip: AudioEngineClip | null;
  } {
    const sameTrack = this.currentClips
      .filter((candidate) => candidate.trackId === clip.trackId)
      .sort((a, b) => a.startUs - b.startUs);
    const idx = sameTrack.findIndex((candidate) => candidate.id === clip.id);
    return {
      previousClip: idx > 0 ? (sameTrack[idx - 1] ?? null) : null,
      nextClip: idx >= 0 ? (sameTrack[idx + 1] ?? null) : null,
    };
  }

  private async scheduleClip(clip: AudioEngineClip, generation: number): Promise<boolean> {
    if (!this.ctx || !this.masterGain) return false;
    if (this.scheduler.getGlobalSpeed() <= 0) return false; // No backward playback

    const sourceKey = clip.sourcePath;
    if (!sourceKey) return false;

    const clipStartS = clip.startUs / 1_000_000;
    const clipDurationS = clip.durationUs / 1_000_000;
    const clipEndS = clipStartS + clipDurationS;
    const currentTimeS = this.getCurrentTimeS();
    if (clipEndS <= currentTimeS) return false;

    const window = this.buildClipPlaybackWindow(
      clip,
      currentTimeS,
      this.scheduler.getGlobalSpeed(),
    );
    if (!window) return false;

    const currentSourceTimeS = this.getSourceTimeForClipLocal(window, window.currentClipLocalS);
    const firstChunkIndex = this.getChunkIndex(Math.max(0, currentSourceTimeS));

    // Decode only the first chunk before starting playback. Subsequent
    // chunks are decoded and scheduled in the background as they become
    // available — that way long clips don't block the kickoff waiting for
    // every chunk in the range to come back from the worker.
    const firstChunk = await this.ensureChunkDecoded(sourceKey, clip.fileHandle, firstChunkIndex);
    if (!firstChunk) return false;
    if (generation !== this.scheduleGeneration) return false;
    if (!this.scheduler.isPlayingActive()) return false;

    // Anchor scheduling to the scheduler's kickoff time, not raw ctx.currentTime.
    // During the kickoff window the kickoff is in the future, so all initial
    // source nodes start together at that exact moment — that's the sync
    // point shared with the video render loop (which reads getCurrentTimeS
    // and stays at baseTimeS until kickoff is reached).
    const audioNowS = Math.max(this.ctx.currentTime, this.scheduler.getPlaybackStartCtxTimeS());
    const playStartS =
      currentTimeS < window.effectiveStartS
        ? audioNowS + (window.effectiveStartS - currentTimeS) / this.scheduler.getGlobalSpeed()
        : audioNowS;

    const sourceEndS = currentSourceTimeS + window.remainingInClipS * window.clipSpeed;
    const lastChunkIndex = this.getChunkIndex(Math.max(currentSourceTimeS, sourceEndS - 1e-6));

    this.streamClipPlayback({
      clip,
      sourceKey,
      generation,
      window,
      playStartS,
      currentSourceTimeS,
      firstChunkIndex,
      lastChunkIndex,
      firstChunk,
    });

    return true;
  }

  private streamClipPlayback(args: {
    clip: AudioEngineClip;
    sourceKey: string;
    generation: number;
    window: ClipPlaybackWindow;
    playStartS: number;
    currentSourceTimeS: number;
    firstChunkIndex: number;
    lastChunkIndex: number;
    firstChunk: AudioChunk;
  }) {
    if (!this.ctx || !this.masterGain) return;

    const {
      clip,
      sourceKey,
      generation,
      window,
      playStartS,
      currentSourceTimeS,
      firstChunkIndex,
      lastChunkIndex,
      firstChunk,
    } = args;

    // Per-clip audio graph (shared by every chunk source we schedule below).
    const clipInputNode = this.ctx.createGain();
    const clipGain = this.ctx.createGain();
    const { destroy: destroyEffects } = this.graphBuilder.buildClipGraph({
      audioContext: this.ctx,
      sourceNode: clipInputNode,
      audioBalance: window.audioBalance,
      effects: clip.audioEffects ?? [],
      clipGain,
      masterGain: this.masterGain,
      trackId: clip.trackId,
      analyserNodes: this.analyserNodes,
    });

    const totalSafeDurationS = window.remainingInClipS * window.clipSpeed;
    const playedClipDurationS = totalSafeDurationS / window.effectiveSpeed;
    const endAtS = playStartS + playedClipDurationS;

    // Fade envelope on clipGain — set up once for the whole clip.
    const gainAtClipTime = (tClipS: number) =>
      getGainAtClipTime({
        clipDurationS: window.clipDurationS,
        fadeInS: window.fadeInS,
        fadeOutS: window.fadeOutS,
        fadeInCurve: window.fadeInCurve,
        fadeOutCurve: window.fadeOutCurve,
        baseGain: window.audioGain,
        tClipS,
      });

    // Clip-local time advances at globalSpeed per wall-clock second.
    const globalSpeed = Math.max(1e-9, window.globalSpeed);
    const clipLocalToCtxS = (tClipS: number) =>
      playStartS + (tClipS - window.currentClipLocalS) / globalSpeed;

    const t0 = window.currentClipLocalS;
    const t1 = window.currentClipLocalS + window.remainingInClipS;
    const gainParam: any = clipGain.gain;

    gainParam.cancelScheduledValues?.(this.ctx.currentTime);
    gainParam.setValueAtTime?.(gainAtClipTime(t0), playStartS);

    if (window.fadeInS > 0 && t0 < window.fadeInS && t1 > 0) {
      const rampEndClipS = Math.min(window.fadeInS, t1);
      const rampEndAtS = clipLocalToCtxS(rampEndClipS);
      this.scheduleGainCurve({
        gainParam,
        startClipS: t0,
        endClipS: rampEndClipS,
        startAtS: playStartS,
        endAtS: rampEndAtS,
        getGainAtClipTime: gainAtClipTime,
      });
    }

    const outStartClipS = window.clipDurationS - window.fadeOutS;
    if (window.fadeOutS > 0 && t1 > outStartClipS) {
      const rampStartClipS = Math.max(outStartClipS, t0);
      const rampStartAtS = clipLocalToCtxS(rampStartClipS);
      gainParam.setValueAtTime?.(gainAtClipTime(rampStartClipS), rampStartAtS);
      this.scheduleGainCurve({
        gainParam,
        startClipS: rampStartClipS,
        endClipS: t1,
        startAtS: rampStartAtS,
        endAtS: Math.max(rampStartAtS, endAtS),
        getGainAtClipTime: gainAtClipTime,
      });
    }

    // Streaming state shared across chunk schedules.
    const targetNodeSet = this.activePlaybackCollection.nodes;
    const targetCleanupMap = this.activePlaybackCollection.cleanups;
    const state = {
      scheduledCtxTimeS: playStartS,
      currentSourceTimeS,
      remainingToPlayS: totalSafeDurationS,
      chunkNodes: [] as AudioBufferSourceNode[],
      scheduledTotal: 0,
      endedTotal: 0,
      streamingDone: false,
      teardownDone: false,
    };

    const teardown = () => {
      if (state.teardownDone) return;
      state.teardownDone = true;
      destroyEffects();
      try {
        clipInputNode.disconnect();
      } catch {
        /* no-op */
      }
      try {
        clipGain.disconnect();
      } catch {
        /* no-op */
      }
      for (const node of state.chunkNodes) {
        targetNodeSet.delete(node);
        targetCleanupMap.delete(node);
        try {
          node.disconnect();
        } catch {
          /* no-op */
        }
      }
    };

    const maybeTeardown = () => {
      if (state.streamingDone && state.endedTotal >= state.scheduledTotal) {
        teardown();
      }
    };

    // If the decoder fell behind real time, advance the scheduling cursor so
    // the next source plays at the position the clock thinks we should be at.
    // We drop the audio that "should have played" during the gap — silence is
    // preferable to losing video/audio sync.
    const compensateForRealTimeGap = () => {
      if (!this.ctx) return;
      const ctxNow = this.ctx.currentTime;
      if (state.scheduledCtxTimeS >= ctxNow) return;
      const lostCtxS = ctxNow - state.scheduledCtxTimeS;
      const lostSourceS = lostCtxS * window.effectiveSpeed;
      state.scheduledCtxTimeS = ctxNow;
      state.currentSourceTimeS += lostSourceS;
      state.remainingToPlayS = Math.max(0, state.remainingToPlayS - lostSourceS);
    };

    const scheduleSource = (chunk: AudioChunk) => {
      if (!this.ctx || state.teardownDone) return;
      if (state.remainingToPlayS <= 0) return;

      compensateForRealTimeGap();
      if (state.remainingToPlayS <= 0) return;

      const chunkStartS = chunk.startTimeS;
      const chunkEndS = chunk.startTimeS + chunk.durationS;
      if (state.currentSourceTimeS >= chunkEndS) return;

      const offsetInChunkS = Math.max(0, state.currentSourceTimeS - chunkStartS);
      const availableInChunkS = chunk.durationS - offsetInChunkS;
      const playDurationS = Math.min(state.remainingToPlayS, availableInChunkS);
      if (playDurationS <= 0) return;

      const sourceNode = this.ctx.createBufferSource();
      sourceNode.buffer = chunk.buffer;
      if (sourceNode.playbackRate) {
        sourceNode.playbackRate.value = window.effectiveSpeed;
      }
      sourceNode.connect(clipInputNode);
      sourceNode.start(state.scheduledCtxTimeS, offsetInChunkS, playDurationS);

      state.chunkNodes.push(sourceNode);
      state.scheduledTotal += 1;
      targetNodeSet.add(sourceNode);
      // Every chunk node maps to the same teardown function. Stop() iterates
      // these via stopNodeCollection — teardown is idempotent via the flag.
      targetCleanupMap.set(sourceNode, teardown);

      sourceNode.onended = () => {
        targetNodeSet.delete(sourceNode);
        targetCleanupMap.delete(sourceNode);
        state.endedTotal += 1;
        maybeTeardown();
      };

      state.scheduledCtxTimeS += playDurationS / window.effectiveSpeed;
      state.currentSourceTimeS += playDurationS;
      state.remainingToPlayS -= playDurationS;
    };

    // Schedule the first chunk synchronously so audio can start at kickoff.
    scheduleSource(firstChunk);

    if (state.scheduledTotal === 0) {
      teardown();
      return;
    }

    // Stream the remaining chunks, throttled to a fixed lookahead window. The
    // loop survives gaps where every scheduled source has already played
    // out — it only tears down when the user stops, the generation flips, or
    // the clip is fully scheduled and all sources have ended (maybeTeardown).
    void (async () => {
      let i = firstChunkIndex + 1;
      while (i <= lastChunkIndex) {
        if (state.teardownDone) return;
        if (state.remainingToPlayS <= 0) break;

        const canProceed = await this.waitForSchedulingSlot(state, generation);
        if (!canProceed) {
          if (!state.teardownDone) teardown();
          return;
        }

        // After waking up, real time may have outrun us — re-anchor and skip
        // any chunks that fall entirely behind the new cursor.
        compensateForRealTimeGap();
        if (state.remainingToPlayS <= 0) break;
        const expectedChunkIdx = this.getChunkIndex(state.currentSourceTimeS);
        if (expectedChunkIdx > i) {
          i = expectedChunkIdx;
          continue;
        }

        const chunk = await this.ensureChunkDecoded(sourceKey, clip.fileHandle, i);
        if (state.teardownDone) return;
        if (generation !== this.scheduleGeneration) {
          teardown();
          return;
        }
        if (!this.scheduler.isPlayingActive()) {
          teardown();
          return;
        }
        if (chunk) {
          scheduleSource(chunk);
        }
        i += 1;
      }

      state.streamingDone = true;
      maybeTeardown();
    })();
  }

  private async waitForSchedulingSlot(
    state: { teardownDone: boolean; scheduledCtxTimeS: number },
    generation: number,
  ): Promise<boolean> {
    while (true) {
      if (state.teardownDone) return false;
      if (generation !== this.scheduleGeneration) return false;
      if (!this.scheduler.isPlayingActive()) return false;
      if (!this.ctx) return false;

      const slackS = state.scheduledCtxTimeS - this.ctx.currentTime - this.schedulingLookaheadS;
      if (slackS <= 0) return true;

      // Sleep until we're close enough to needing the next chunk — but cap so
      // we re-check generation/isPlaying state periodically.
      const sleepMs = Math.min(1000, Math.max(50, slackS * 1000 * 0.5));
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  private stopNodeCollection(
    nodes: Set<AudioBufferSourceNode>,
    cleanups: Map<AudioBufferSourceNode, () => void>,
  ) {
    for (const node of nodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        /* no-op */
      }

      const cleanup = cleanups.get(node);
      if (cleanup) {
        try {
          cleanup();
        } catch {
          /* no-op */
        }
        cleanups.delete(node);
      }
    }
    nodes.clear();
    cleanups.clear();
  }

  private stopAllNodes() {
    this.stopNodeCollection(this.activeNodes, this.activeCleanups);
  }

  private getSourceTimeForClipLocal(window: ClipPlaybackWindow, clipLocalS: number): number {
    return window.effectiveSourceStartS + clipLocalS * window.clipSpeed;
  }

  private scheduleGainCurve(params: {
    gainParam: AudioParam & {
      setValueCurveAtTime?: (
        values: Float32Array,
        startTime: number,
        duration: number,
      ) => AudioParam;
      linearRampToValueAtTime?: (value: number, endTime: number) => AudioParam;
    };
    startClipS: number;
    endClipS: number;
    startAtS: number;
    endAtS: number;
    getGainAtClipTime: (clipTimeS: number) => number;
  }) {
    const durationS = params.endAtS - params.startAtS;
    const clipDurationS = params.endClipS - params.startClipS;
    if (durationS <= 0 || clipDurationS <= 0) return;

    if (typeof params.gainParam.setValueCurveAtTime !== 'function') {
      params.gainParam.linearRampToValueAtTime?.(
        params.getGainAtClipTime(params.endClipS),
        params.endAtS,
      );
      return;
    }

    const steps = 64;
    const values = new Float32Array(steps);
    for (let i = 0; i < steps; i += 1) {
      const progress = steps <= 1 ? 1 : i / (steps - 1);
      values[i] = params.getGainAtClipTime(params.startClipS + clipDurationS * progress);
    }

    params.gainParam.setValueCurveAtTime(values, params.startAtS, durationS);
  }

  destroy() {
    this.scheduler.destroy();
    this.stopAllNodes();
    this.stopScrubPreview();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.chunkCache.clear();
    this.chunkDecodeInFlight.clear();
    this.failedChunkKeys.clear();
    this.chunkLruKeys.clear();
    this.fileBlobCache.clear();
    this.analyserNodes.clear();

    if (this.decodeWorker) {
      this.decodeWorker.terminate();
      this.decodeWorker = null;
    }
    for (const [, pending] of this.decodePending.entries()) {
      pending.reject(new Error('AudioEngine destroyed'));
    }
    this.decodePending.clear();
  }
}
