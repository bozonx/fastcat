import { createDevLogger } from '~/utils/dev-logger';
import { MAX_AUDIO_FILE_BYTES } from '~/utils/constants';
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
  AudioEngineClip,
  AudioNodeCollection,
  ClipPlaybackWindow,
} from '~/utils/video-editor/audio-engine.types';

export type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';

const logger = createDevLogger('AudioEngine');

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private decodedCache = new Map<string, AudioBuffer | null>();
  private decodeInFlight = new Map<string, Promise<AudioBuffer | null>>();
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

    // Best-effort prefetch: decode lazily and yield between tasks to avoid blocking UI.
    // Decoding is still async and browser-implemented; we just avoid a tight loop.
    for (const clip of clips) {
      const sourceKey = clip.sourcePath;
      if (!sourceKey) continue;
      if (this.decodedCache.has(sourceKey)) continue;
      void this.ensureDecoded(sourceKey, clip.fileHandle);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  updateTimelineLayout(clips: AudioEngineClip[]) {
    this.currentClips = clips;
    this.cleanupCache();
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
    for (const key of this.decodedCache.keys()) {
      if (!activePaths.has(key)) {
        this.decodedCache.delete(key);
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

  private async ensureDecoded(sourceKey: string, fileHandle: FileSystemFileHandle) {
    const existing = this.decodeInFlight.get(sourceKey);
    if (existing) return existing;

    if (this.decodedCache.has(sourceKey)) {
      const cached = this.decodedCache.get(sourceKey);
      // null means decode failed previously, not in-progress
      return cached ?? null;
    }

    const task = this.withDecodeSlot(async () => {
      try {
        const file = await fileHandle.getFile();
        if (file.size > MAX_AUDIO_FILE_BYTES) {
          throw new Error('Audio file is too large to decode in memory');
        }
        const arrayBuffer = await file.arrayBuffer();
        if (!this.ctx) return null;

        const decoded = await this.decodeInWorker(arrayBuffer, sourceKey);
        if (!decoded) {
          console.warn(`[AudioEngine] Worker returned null for ${sourceKey}`);
          return null;
        }
        if (!decoded.channelBuffers?.length) {
          console.warn(`[AudioEngine] Worker returned empty channels for ${sourceKey}`);
          return null;
        }

        const numChannels = Math.max(1, Math.round(Number(decoded.numberOfChannels) || 1));
        const sampleRate = Math.max(8000, Math.round(Number(decoded.sampleRate) || 48000));
        const first = decoded.channelBuffers[0];
        if (!first) {
          console.warn(`[AudioEngine] First channel buffer is undefined for ${sourceKey}`);
          return null;
        }
        const frames = Math.floor(first.byteLength / Float32Array.BYTES_PER_ELEMENT);
        if (frames <= 0) {
          console.warn(`[AudioEngine] Decoded audio has 0 frames for ${sourceKey}`);
          return null;
        }

        const audioBuffer = this.ctx.createBuffer(numChannels, frames, sampleRate);
        for (let ch = 0; ch < numChannels; ch += 1) {
          const buf = decoded.channelBuffers[ch];
          if (!buf) continue;
          const data = new Float32Array(buf);
          audioBuffer.copyToChannel(data, ch, 0);
        }

        logger.info(
          `Successfully decoded ${sourceKey}: ${numChannels}ch, ${sampleRate}Hz, ${frames} frames`,
        );
        this.decodedCache.set(sourceKey, audioBuffer);
        return audioBuffer;
      } catch (err) {
        const name = (err as any)?.name;
        if (name !== 'NoAudioTrackError' && name !== 'UnsupportedFormatError') {
          console.warn('[AudioEngine] Failed to decode audio', err);
        }
        this.decodedCache.set(sourceKey, null);
        return null;
      } finally {
        this.decodeInFlight.delete(sourceKey);
      }
    });

    this.decodeInFlight.set(sourceKey, task);
    return task;
  }

  private async getDecodedBuffer(clip: AudioEngineClip) {
    const sourceKey = clip.sourcePath;
    if (!sourceKey) {
      return null;
    }

    const buffer = this.decodedCache.get(sourceKey) ?? null;
    if (buffer) {
      return buffer;
    }

    const inFlight = this.decodeInFlight.get(sourceKey);
    if (inFlight) {
      return await inFlight;
    }

    return await this.ensureDecoded(sourceKey, clip.fileHandle);
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
    buffer: AudioBuffer,
    window: ClipPlaybackWindow,
    options?: {
      maxPlaybackDurationS?: number;
      nodeSet?: Set<AudioBufferSourceNode>;
      cleanupMap?: Map<AudioBufferSourceNode, () => void>;
    },
  ) {
    if (!this.ctx || !this.masterGain) return;

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

    const epsilon = 1 / Math.max(1, Math.round(buffer.sampleRate || 48000));
    if (safeBufferOffsetS >= buffer.duration) {
      safeBufferOffsetS = Math.max(0, buffer.duration - epsilon);
    }

    const remainingInBufferS = Math.max(0, buffer.duration - safeBufferOffsetS);
    safeDurationToPlayS = Math.min(
      Math.max(safeDurationToPlayS, epsilon),
      Math.max(remainingInBufferS, epsilon),
    );

    if (!Number.isFinite(safeDurationToPlayS) || safeDurationToPlayS <= 0) {
      return;
    }

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    if (sourceNode.playbackRate) {
      sourceNode.playbackRate.value = window.effectiveSpeed;
    }

    const clipGain = this.ctx.createGain();

    const { destroy: destroyEffects } = this.graphBuilder.buildClipGraph({
      audioContext: this.ctx,
      sourceNode,
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

    sourceNode.start(startAtS, safeBufferOffsetS, safeDurationToPlayS);

    const targetNodeSet = options?.nodeSet ?? this.activePlaybackCollection.nodes;
    const targetCleanupMap = options?.cleanupMap ?? this.activePlaybackCollection.cleanups;
    targetNodeSet.add(sourceNode);
    targetCleanupMap.set(sourceNode, destroyEffects);

    sourceNode.onended = () => {
      targetNodeSet.delete(sourceNode);
      const cleanup = targetCleanupMap.get(sourceNode);
      if (cleanup) {
        cleanup();
        targetCleanupMap.delete(sourceNode);
      }
    };
  }

  private scheduleLookahead() {
    if (!this.scheduler.isPlayingActive() || this.scheduler.getGlobalSpeed() <= 0) return;
    const LOOKAHEAD_S = 0.5;
    const currentS = this.getCurrentTimeS();
    const endS = currentS + LOOKAHEAD_S;

    for (const clip of this.currentClips) {
      if (this.scheduler.hasScheduledClip(clip.id)) continue;

      const clipStartS = clip.startUs / 1_000_000;
      const clipEndS = clipStartS + clip.durationUs / 1_000_000;

      if (clipStartS <= endS && clipEndS >= currentS) {
        this.scheduler.markClipScheduled(clip.id);
        void this.scheduleClip(clip, currentS);
      }
    }
  }

  async play(timeUs: number, speed = 1) {
    this.stopScrubPreview();
    await this.scheduler.play(timeUs, speed);
  }

  stop() {
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

      const buffer = await this.getDecodedBuffer(clip);
      if (!buffer) {
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
        buffer,
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
    this.scheduler.setGlobalSpeed(speed);
  }

  seek(timeUs: number) {
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

  private async scheduleClip(clip: AudioEngineClip, _triggerTimeS: number) {
    if (!this.ctx || !this.masterGain) return;
    if (this.scheduler.getGlobalSpeed() <= 0) return; // No backward playback

    const buffer = await this.getDecodedBuffer(clip);
    if (!buffer) return;

    const clipStartS = clip.startUs / 1_000_000;
    const clipDurationS = clip.durationUs / 1_000_000;
    const clipEndS = clipStartS + clipDurationS;
    const currentTimeS = this.getCurrentTimeS();

    if (clipEndS <= currentTimeS) return;

    const window = this.buildClipPlaybackWindow(
      clip,
      currentTimeS,
      this.scheduler.getGlobalSpeed(),
    );
    if (!window) return;

    const playStartS =
      currentTimeS < window.effectiveStartS
        ? this.ctx.currentTime +
          (window.effectiveStartS - currentTimeS) / this.scheduler.getGlobalSpeed()
        : this.ctx.currentTime;

    await this.playClipSegment(clip, buffer, { ...window, startAtS: playStartS });
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
    this.decodedCache.clear();
    this.decodeInFlight.clear();
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
