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

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private decodedCache = new Map<string, AudioBuffer | null>();
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

  async init() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48000 });
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
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
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  getCurrentTimeS(): number {
    if (!this.isPlaying || !this.ctx) return this.baseTimeS;
    return this.baseTimeS + (this.ctx.currentTime - this.playbackContextTimeS);
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

    // If the clip is already completely in the past relative to current time, skip
    if (clipEndS <= currentTimeS) return;

    const sourceStartS = clip.sourceStartUs / 1_000_000;
    const sourceDurationS = Math.max(0, clip.sourceDurationUs / 1_000_000);

    const speedRaw = clip.speed;
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw)
        ? Math.max(0.1, Math.min(10, speedRaw))
        : 1;

    const effectiveSpeed = speed * Math.abs(this.globalSpeed);

    const localOffsetInClipS = Math.max(0, currentTimeS - clipStartS);

    const { fadeInS, fadeOutS } = computeFadeDurationsSeconds({
      clipDurationS,
      fadeInUs: clip.audioFadeInUs,
      fadeOutUs: clip.audioFadeOutUs,
    });

    const audioGain = normalizeGain(clip.audioGain, 1);
    const audioBalance = normalizeBalance(clip.audioBalance, 0);

    // When to start playing in AudioContext time.
    const playStartS =
      currentTimeS < clipStartS
        ? this.ctx.currentTime + (clipStartS - currentTimeS) / Math.abs(this.globalSpeed)
        : this.ctx.currentTime;

    // Where to start in the audio buffer.
    const bufferOffsetS = sourceStartS + localOffsetInClipS * speed;

    const maxPlayableFromBufferS = Math.max(0, buffer.duration - sourceStartS);
    const maxPlayableFromSourceS = sourceDurationS > 0 ? sourceDurationS : Number.POSITIVE_INFINITY;
    const maxPlayableS = Math.min(maxPlayableFromBufferS, maxPlayableFromSourceS);
    const remainingPlayableS = maxPlayableS - localOffsetInClipS * speed;

    const remainingInClipS = Math.max(0, clipDurationS - localOffsetInClipS);
    const durationToPlayS = Math.min(remainingInClipS * speed, remainingPlayableS);

    let safeBufferOffsetS = bufferOffsetS;
    let safeDurationToPlayS = durationToPlayS;

    if (!Number.isFinite(safeBufferOffsetS) || safeBufferOffsetS < 0) {
      console.warn(
        `[AudioEngine] Invalid bufferOffsetS: ${safeBufferOffsetS} (buffer.duration: ${buffer.duration}) for clip ${clip.id}`,
      );
      return;
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
      console.warn(`[AudioEngine] Invalid durationToPlayS: ${durationToPlayS} for clip ${clip.id}`);
      return;
    }

    logger.debug(`scheduleClip ${clip.id}`, {
      clipStartS,
      clipDurationS,
      currentTimeS,
      bufferOffsetS,
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

    const t0 = localOffsetInClipS;
    const t1 = localOffsetInClipS + remainingInClipS;
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
