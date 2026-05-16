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
  private readonly maxChunkCount = 50;
  private chunkCache = new Map<string, AudioChunk[]>();
  private chunkDecodeInFlight = new Map<string, Promise<AudioChunk | null>>();
  private failedChunkKeys = new Set<string>();
  private chunkLruKeys: string[] = [];
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
    const idx = this.chunkLruKeys.indexOf(chunkKey);
    if (idx >= 0) {
      this.chunkLruKeys.splice(idx, 1);
    }
    this.chunkLruKeys.push(chunkKey);
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
    if (this.chunkLruKeys.length <= this.maxChunkCount) return;

    const pinned = this.collectPinnedBuffers();
    let i = 0;
    while (this.chunkLruKeys.length > this.maxChunkCount && i < this.chunkLruKeys.length) {
      const oldestKey = this.chunkLruKeys[i];
      if (!oldestKey) {
        i += 1;
        continue;
      }

      const colonIdx = oldestKey.lastIndexOf(':');
      if (colonIdx < 0) {
        this.chunkLruKeys.splice(i, 1);
        continue;
      }

      const sourceKey = oldestKey.slice(0, colonIdx);
      const chunkIndex = parseInt(oldestKey.slice(colonIdx + 1), 10);

      const chunks = this.chunkCache.get(sourceKey);
      if (!chunks) {
        this.chunkLruKeys.splice(i, 1);
        continue;
      }

      const idx = chunks.findIndex((c) => c.chunkIndex === chunkIndex);
      if (idx < 0) {
        this.chunkLruKeys.splice(i, 1);
        continue;
      }

      const chunk = chunks[idx];
      if (chunk && pinned.has(chunk.buffer)) {
        // Currently feeding an active source node — keep it, look further.
        i += 1;
        continue;
      }

      chunks.splice(idx, 1);
      if (chunks.length === 0) {
        this.chunkCache.delete(sourceKey);
      }
      this.chunkLruKeys.splice(i, 1);
    }
  }

  public async extractPeaks(
    fileHandle: FileSystemFileHandle,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ): Promise<number[][] | null> {
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

      if (this.ctx.destination) {
        this.ctx.destination.channelCount = channelCount;
      }
    } else {
      if (this.ctx.destination && this.ctx.destination.channelCount !== channelCount) {
        this.ctx.destination.channelCount = channelCount;
      }
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
        this.chunkLruKeys = this.chunkLruKeys.filter((k) => !k.startsWith(`${key}:`));
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
    const len = this.analyserData.length;
    for (let i = 0; i < len; i++) {
      const val = this.analyserData[i];
      if (!val) continue; // handle NaN/undefined
      const abs = Math.abs(val);
      sumSquares += abs * abs;
      if (abs > peak) peak = abs;
    }

    const rms = Math.sqrt(sumSquares / len);

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

        logger.info(
          `Decoded chunk ${chunkKey}: ${numChannels}ch, ${sampleRate}Hz, ${totalFrames} frames`,
        );
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

    if (typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw <= 0) {
      return null;
    }

    const clipSpeed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
        ? Math.min(10, speedRaw)
        : 1;
    const effectiveSpeed = clipSpeed * speed;

    if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) {
      return null;
    }

    const { previousClip, nextClip } = this.getAdjacentClips(clip);
    const { fadeInS, fadeOutS, fadeInCurve, fadeOutCurve } = resolveEffectiveFadeDurationsSeconds({
      clipDurationS,
      clip,
      previousClip,
      nextClip,
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
      clipDurationS,
      clipSpeed,
      fadeInS,
      fadeOutS,
      fadeInCurve,
      fadeOutCurve,
      audioGain,
      audioBalance,
      effectiveSpeed,
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

    const currentSourceTimeS =
      window.effectiveSourceStartS + window.currentClipLocalS * window.clipSpeed;

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

    const lastChunk = chunks[chunks.length - 1];
    const maxSourceTimeS = lastChunk ? lastChunk.startTimeS + lastChunk.durationS : 0;

    if (safeBufferOffsetS >= maxSourceTimeS) {
      safeBufferOffsetS = Math.max(0, maxSourceTimeS - epsilon);
    }

    const remainingInBufferS = Math.max(0, maxSourceTimeS - safeBufferOffsetS);
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

    const t0 = window.currentClipLocalS;
    const t1 = window.currentClipLocalS + playedClipDurationS;
    const gainParam: any = clipGain.gain;

    gainParam.cancelScheduledValues?.(this.ctx.currentTime);
    gainParam.setValueAtTime?.(gainAtClipTime(t0), startAtS);

    if (window.fadeInS > 0 && t0 < window.fadeInS && t1 > 0) {
      const rampEndClipS = Math.min(window.fadeInS, t1);
      const rampEndAtS = startAtS + (rampEndClipS - t0);
      gainParam.linearRampToValueAtTime?.(gainAtClipTime(rampEndClipS), rampEndAtS);
    }

    const outStartClipS = window.clipDurationS - window.fadeOutS;
    if (window.fadeOutS > 0 && t1 > outStartClipS) {
      const rampStartClipS = Math.max(outStartClipS, t0);
      const rampStartAtS = startAtS + (rampStartClipS - t0);
      gainParam.setValueAtTime?.(gainAtClipTime(rampStartClipS), rampStartAtS);
      gainParam.linearRampToValueAtTime?.(gainAtClipTime(t1), Math.max(rampStartAtS, endAtS));
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
      } catch {}
      for (const node of chunkNodes) {
        targetNodeSet.delete(node);
        try {
          node.disconnect();
        } catch {}
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
    this.schedulingClipIds.clear();
    this.stopScrubPreview();
    await this.scheduler.play(timeUs, speed);
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
      this.masterGain.gain.value = this.currentMasterVolume;
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

    const chunks = await this.getDecodedChunks(clip);

    if (chunks.length === 0) return false;
    if (generation !== this.scheduleGeneration) return false;
    if (!this.scheduler.isPlayingActive()) return false;

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

    const playStartS =
      currentTimeS < window.effectiveStartS
        ? this.ctx.currentTime +
          (window.effectiveStartS - currentTimeS) / this.scheduler.getGlobalSpeed()
        : this.ctx.currentTime;

    await this.playClipSegment(
      clip,
      chunks,
      { ...window, startAtS: playStartS },
      { requirePlayingActive: true },
    );
    return true;
  }

  private stopNodeCollection(
    nodes: Set<AudioBufferSourceNode>,
    cleanups: Map<AudioBufferSourceNode, () => void>,
  ) {
    for (const node of nodes) {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {}

      const cleanup = cleanups.get(node);
      if (cleanup) {
        try {
          cleanup();
        } catch (e) {}
        cleanups.delete(node);
      }
    }
    nodes.clear();
    cleanups.clear();
  }

  private stopAllNodes() {
    this.stopNodeCollection(this.activeNodes, this.activeCleanups);
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
    this.chunkLruKeys = [];
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
