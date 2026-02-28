import { createDevLogger } from '~/utils/dev-logger';
import {
  computeFadeDurationsSeconds,
  getGainAtClipTime,
  normalizeBalance,
  normalizeGain,
} from '~/utils/audio/envelope';

const logger = createDevLogger('AudioEngine');

export interface AudioEngineClip {
  id: string;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  startUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceDurationUs: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
}

interface DecodeRequest {
  type: 'decode' | 'extract-peaks';
  id: number;
  sourceKey: string;
  arrayBuffer: ArrayBuffer;
  options?: {
    maxLength?: number;
    precision?: number;
  };
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
    peaks?: number[][];
  };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private decodedCache = new Map<string, AudioBuffer | null>();
  private reversedDecodedCache = new Map<string, AudioBuffer | null>();
  private decodeInFlight = new Map<string, Promise<AudioBuffer | null>>();
  private activeNodes = new Map<string, AudioBufferSourceNode>();
  private masterGain: GainNode | null = null;
  private isPlaying = false;
  private baseTimeS = 0;
  private playbackContextTimeS = 0;
  private currentClips: AudioEngineClip[] = [];

  private decodeWorker: Worker | null = null;
  private decodeCallId = 0;
  private decodePending = new Map<number, { resolve: Function; reject: Function }>();
  private decodeQueue: Array<() => void> = [];
  private decodeInFlightCount = 0;
  private readonly maxDecodeConcurrency = 2;
  private currentVolume = 1;

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
    });

    this.decodeWorker = worker;
    return worker;
  }

  private extractPeaksInWorker(
    arrayBuffer: ArrayBuffer,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ) {
    const worker = this.ensureDecodeWorker();
    return new Promise<DecodeResponse['result']>((resolve, reject) => {
      const id = ++this.decodeCallId;
      this.decodePending.set(id, { resolve, reject });
      const req: DecodeRequest = { type: 'extract-peaks', id, sourceKey, arrayBuffer, options };
      worker.postMessage(req, [arrayBuffer]);
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
        const arrayBuffer = await file.arrayBuffer();

        const decoded = await this.extractPeaksInWorker(arrayBuffer, sourceKey, options);
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
      this.masterGain.gain.value = this.currentVolume;
      this.masterGain.connect(this.ctx.destination);
      if (this.ctx.destination) {
        this.ctx.destination.channelCount = channelCount;
      }
    } else {
      if (this.ctx.destination && this.ctx.destination.channelCount !== channelCount) {
        this.ctx.destination.channelCount = channelCount;
      }
    }
  }

  resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err) => {
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
        sourceDurationUs: c.sourceDurationUs,
      })),
    );
    this.currentClips = clips;

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
    if (this.isPlaying) {
      // Re-evaluate playing nodes
      const currentTimeUs = this.getCurrentTimeUs();
      this.stopAllNodes();
      this.play(currentTimeUs);
    }
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
        if (name !== 'NoAudioTrackError') {
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

  private globalSpeed = 1;

  async play(timeUs: number, speed = 1) {
    this.isPlaying = true;
    this.globalSpeed = speed;
    const timeS = timeUs / 1_000_000;
    this.baseTimeS = timeS;

    if (!this.ctx) return;

    this.playbackContextTimeS = this.ctx.currentTime;

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch((err) => {
        console.warn('[AudioEngine] play: Failed to resume AudioContext', err);
      });
      // Update context time after resume since it might have been delayed
      this.playbackContextTimeS = this.ctx.currentTime;
    }

    if (this.globalSpeed !== 0) {
      for (const clip of this.currentClips) {
        // Fire and forget
        void this.scheduleClip(clip, timeS);
      }
    }
  }

  stop() {
    this.isPlaying = false;
    this.stopAllNodes();
  }

  setGlobalSpeed(speed: number) {
    const parsed = Number(speed);
    if (!Number.isFinite(parsed)) return;

    const currentTimeS = this.getCurrentTimeS();
    this.globalSpeed = parsed;

    if (!this.isPlaying) {
      return;
    }

    if (!this.ctx) {
      return;
    }

    this.stopAllNodes();

    this.baseTimeS = currentTimeS;
    this.playbackContextTimeS = this.ctx.currentTime;

    for (const clip of this.currentClips) {
      void this.scheduleClip(clip, currentTimeS);
    }
  }

  seek(timeUs: number) {
    if (this.isPlaying) {
      this.stopAllNodes();

      const timeS = timeUs / 1_000_000;
      this.baseTimeS = timeS;

      if (!this.ctx) return;

      this.playbackContextTimeS = this.ctx.currentTime;

      for (const clip of this.currentClips) {
        void this.scheduleClip(clip, timeS);
      }
    }
  }

  setVolume(volume: number) {
    this.currentVolume = Math.max(0, Math.min(2, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.currentVolume;
    }
  }

  getCurrentTimeS(): number {
    if (!this.isPlaying || !this.ctx) return this.baseTimeS;
    return this.baseTimeS + (this.ctx.currentTime - this.playbackContextTimeS) * this.globalSpeed;
  }

  getCurrentTimeUs(): number {
    const s = this.getCurrentTimeS();
    return Math.round(s * 1_000_000);
  }

  private async scheduleClip(clip: AudioEngineClip, currentTimeS: number) {
    if (!this.ctx || !this.masterGain) return;

    const sourceKey = clip.sourcePath;
    if (!sourceKey) return;

    let buffer = this.decodedCache.get(sourceKey) ?? null;
    if (!buffer) {
      const inFlight = this.decodeInFlight.get(sourceKey);
      if (inFlight) {
        logger.debug(`Buffer not in cache for ${clip.id}, awaiting decode...`);
        buffer = await inFlight;
      } else {
        logger.debug(`Buffer not in cache for ${clip.id}, awaiting decode...`);
        buffer = await this.ensureDecoded(sourceKey, clip.fileHandle);
      }
      // Re-evaluate current time since decoding takes time
      currentTimeS = this.getCurrentTimeS();
    }
    if (!this.isPlaying) return;
    if (!buffer) {
      if (!clip.id.endsWith('__audio')) {
        console.warn(
          `[AudioEngine] Buffer could not be decoded for clip ${clip.id} (${sourceKey})`,
        );
      }
      return;
    }

    const clipStartS = clip.startUs / 1_000_000;
    const clipDurationS = clip.durationUs / 1_000_000;
    const clipEndS = clipStartS + clipDurationS;

    const isBackward = this.globalSpeed < 0;

    // If the clip is already completely in the past relative to current time, skip
    if (isBackward) {
      if (clipStartS >= currentTimeS) return;
    } else {
      if (clipEndS <= currentTimeS) return;
    }

    const sourceStartS = clip.sourceStartUs / 1_000_000;
    const sourceDurationS = Math.max(0, clip.sourceDurationUs / 1_000_000);

    const speedRaw = clip.speed;
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw)
        ? Math.max(0.1, Math.min(10, speedRaw))
        : 1;

    const effectiveSpeed = speed * Math.abs(this.globalSpeed);

    const currentClipLocalS = isBackward
      ? Math.max(0, Math.min(clipEndS, currentTimeS) - clipStartS)
      : Math.max(0, currentTimeS - clipStartS);

    const { fadeInS, fadeOutS } = computeFadeDurationsSeconds({
      clipDurationS,
      fadeInUs: clip.audioFadeInUs,
      fadeOutUs: clip.audioFadeOutUs,
    });

    const audioGain = normalizeGain(clip.audioGain, 1);
    const audioBalance = normalizeBalance(clip.audioBalance, 0);

    // When to start playing in AudioContext time.
    const playStartS = isBackward
      ? (currentTimeS > clipEndS ? this.ctx.currentTime + (currentTimeS - clipEndS) / Math.abs(this.globalSpeed) : this.ctx.currentTime)
      : (currentTimeS < clipStartS ? this.ctx.currentTime + (clipStartS - currentTimeS) / Math.abs(this.globalSpeed) : this.ctx.currentTime);

    const originalBufferOffsetS = sourceStartS + currentClipLocalS * speed;

    if (isBackward) {
      let reversedBuffer = this.reversedDecodedCache.get(sourceKey) ?? null;
      if (!reversedBuffer) {
        reversedBuffer = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        for (let i = 0; i < buffer.numberOfChannels; i++) {
          const dest = reversedBuffer.getChannelData(i);
          dest.set(buffer.getChannelData(i));
          dest.reverse();
        }
        this.reversedDecodedCache.set(sourceKey, reversedBuffer);
      }
      buffer = reversedBuffer;
    }

    const remainingInClipS = isBackward ? currentClipLocalS : Math.max(0, clipDurationS - currentClipLocalS);
    const durationToPlayS = remainingInClipS * speed;

    let safeBufferOffsetS = isBackward ? (buffer.duration - originalBufferOffsetS) : originalBufferOffsetS;
    let safeDurationToPlayS = durationToPlayS;

    if (!Number.isFinite(safeBufferOffsetS) || safeBufferOffsetS < 0) {
      safeBufferOffsetS = 0;
    }

    if (safeBufferOffsetS >= buffer.duration) {
      const epsilon = 1 / Math.max(1, Math.round(Number((buffer as any).sampleRate) || 48000));
      safeBufferOffsetS = Math.max(0, buffer.duration - epsilon);
    }

    const epsilon = 1 / Math.max(1, Math.round(Number((buffer as any).sampleRate) || 48000));
    const remainingInBufferS = Math.max(0, buffer.duration - safeBufferOffsetS);
    safeDurationToPlayS = Math.min(
      Math.max(safeDurationToPlayS, epsilon),
      Math.max(remainingInBufferS, epsilon),
    );

    if (!Number.isFinite(safeDurationToPlayS) || safeDurationToPlayS <= 0) {
      return;
    }

    logger.debug(`scheduleClip ${clip.id}`, {
      clipStartS,
      clipDurationS,
      currentTimeS,
      bufferOffsetS: originalBufferOffsetS,
      durationToPlayS,
      playStartS,
      ctxCurrentTime: this.ctx.currentTime,
      bufferDuration: buffer.duration,
    });

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    if (sourceNode.playbackRate) {
      sourceNode.playbackRate.value = effectiveSpeed;
    }

    const clipGain = this.ctx.createGain();

    const anyCtx = this.ctx as any;
    const canPan = typeof anyCtx.createStereoPanner === 'function';
    const panner: StereoPannerNode | null = canPan ? (anyCtx.createStereoPanner() as any) : null;
    if (panner) {
      panner.pan.value = audioBalance;
      sourceNode.connect(panner);
      panner.connect(clipGain);
    } else {
      sourceNode.connect(clipGain);
    }

    clipGain.connect(this.masterGain);

    // Apply clip-local fade envelope (in timeline time, not buffer time).
    // Since playbackRate is set, the node plays `durationToPlayS / speed` seconds in context time,
    // which equals `remainingInClipS`.
    const nowS = this.ctx.currentTime;
    const startAtS = playStartS;
    const endAtS = startAtS + remainingInClipS;

    function gainAtClipTime(tClipS: number): number {
      return getGainAtClipTime({
        clipDurationS,
        fadeInS,
        fadeOutS,
        baseGain: audioGain,
        tClipS,
      });
    }

    const t0 = currentClipLocalS;
    const t1 = isBackward ? Math.max(0, currentClipLocalS - remainingInClipS) : (currentClipLocalS + remainingInClipS);
    const g0 = gainAtClipTime(t0);
    const gainParam: any = clipGain.gain as any;
    if (typeof gainParam.cancelScheduledValues === 'function') {
      gainParam.cancelScheduledValues(nowS);
    }
    if (typeof gainParam.setValueAtTime === 'function') {
      gainParam.setValueAtTime(g0, startAtS);
    } else {
      gainParam.value = g0;
    }

    if (!isBackward) {
      const inEndClipS = fadeInS;
      if (fadeInS > 0 && t0 < inEndClipS && t1 > 0) {
        const rampEndClipS = Math.min(inEndClipS, t1);
        const rampEndAtS = startAtS + (rampEndClipS - t0);
        if (typeof gainParam.linearRampToValueAtTime === 'function') {
          gainParam.linearRampToValueAtTime(gainAtClipTime(rampEndClipS), rampEndAtS);
        } else if (typeof gainParam.setValueAtTime === 'function') {
          gainParam.setValueAtTime(gainAtClipTime(rampEndClipS), rampEndAtS);
        }
      }

      const outStartClipS = clipDurationS - fadeOutS;
      if (fadeOutS > 0 && t1 > outStartClipS) {
        const rampStartClipS = Math.max(outStartClipS, t0);
        const rampStartAtS = startAtS + (rampStartClipS - t0);
        // Ensure we are at the correct value at ramp start, then ramp down to end.
        if (typeof gainParam.setValueAtTime === 'function') {
          gainParam.setValueAtTime(gainAtClipTime(rampStartClipS), rampStartAtS);
        }
        if (typeof gainParam.linearRampToValueAtTime === 'function') {
          gainParam.linearRampToValueAtTime(gainAtClipTime(t1), Math.max(rampStartAtS, endAtS));
        } else if (typeof gainParam.setValueAtTime === 'function') {
          gainParam.setValueAtTime(gainAtClipTime(t1), Math.max(rampStartAtS, endAtS));
        }
      }
    } else {
      // In backward playback, the time t decreases from t0 down to t1.
      // E.g. fading out at the end, if we play backward, we are fading IN.
      // It starts at t0 (which is e.g. end of clip) and goes down to t1 (e.g. start of clip).
      const outStartClipS = clipDurationS - fadeOutS;
      if (fadeOutS > 0 && t0 > outStartClipS) {
        const rampEndClipS = Math.max(outStartClipS, t1); // the time we stop fading (during backward)
        const rampEndAtS = startAtS + (t0 - rampEndClipS) / speed;
        if (typeof gainParam.setValueAtTime === 'function') {
          // It's a bit complex with linearRampToValueAtTime since we ramp to a value over backward time.
          // We can just use setValueAtTime for the endpoints.
          gainParam.linearRampToValueAtTime?.(gainAtClipTime(rampEndClipS), rampEndAtS);
        }
      }
      const inEndClipS = fadeInS;
      if (fadeInS > 0 && t1 < inEndClipS) {
        const rampStartClipS = Math.min(inEndClipS, t0);
        const rampStartAtS = startAtS + (t0 - rampStartClipS) / speed;
        gainParam.setValueAtTime?.(gainAtClipTime(rampStartClipS), rampStartAtS);
        gainParam.linearRampToValueAtTime?.(gainAtClipTime(t1), endAtS);
      }
    }

    sourceNode.start(playStartS, safeBufferOffsetS, safeDurationToPlayS);

    // Keep track to stop if needed
    // Using a composite key since a clip might be split or repeated (id should be unique though)
    this.activeNodes.set(clip.id, sourceNode);

    sourceNode.onended = () => {
      if (this.activeNodes.get(clip.id) === sourceNode) {
        this.activeNodes.delete(clip.id);
      }
    };
  }

  private stopAllNodes() {
    for (const [id, node] of this.activeNodes.entries()) {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // ignore errors if already stopped
      }
    }
    this.activeNodes.clear();
  }

  destroy() {
    this.stopAllNodes();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.decodedCache.clear();
    this.decodeInFlight.clear();

    if (this.decodeWorker) {
      this.decodeWorker.terminate();
      this.decodeWorker = null;
    }
    this.decodePending.clear();
  }
}
