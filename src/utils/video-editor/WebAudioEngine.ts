import { createDevLogger } from '~/utils/dev-logger';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

import { getGainAtClipTime } from '~/utils/audio/envelope';
import { buildAudioEffectGraph } from '~/utils/audio/effect-graph';
import { AudioChunkDecoder } from '~/utils/video-editor/AudioChunkDecoder';
import { planForwardChunkPlayback } from '~/utils/video-editor/audio-seam-plan';
import { SEAM_CROSSFADE_S, equalPowerCurve } from '~/utils/audio/crossfade';
import { AudioGraphBuilder } from '~/utils/video-editor/AudioGraphBuilder';
import { AudioScheduler } from '~/utils/video-editor/AudioScheduler';
import { scheduleGainCurve, stopNodeCollection } from '~/utils/video-editor/audio-node-utils';
import {
  buildClipPlaybackWindow,
  getSourceTimeForClipLocal,
  isReversedClip,
} from '~/utils/video-editor/audio-playback-window';

import type {
  AudioChunk,
  AudioEngineClip,
  AudioNodeCollection,
  ClipPlaybackWindow,
} from '~/utils/video-editor/audio-engine.types';
import type {
  AudioEngineCapabilities,
  IAudioEngine,
} from '~/utils/video-editor/audio-engine.interface';

const logger = createDevLogger('WebAudioEngine');
const TRANSITION_FADE_IN_S = 0.02;
const CHUNK_EDGE_FADE_S = 0.005;

// Equal-power seam curves, computed once and reused for every chunk boundary.
const EQUAL_POWER_FADE_IN_CURVE = equalPowerCurve('in');
const EQUAL_POWER_FADE_OUT_CURVE = equalPowerCurve('out');

interface ForwardSeamGainParams {
  t0: number;
  ctxTotalS: number; // total played span (nominal + tail)
  ctxNominalS: number; // cursor-advancing span; tail crossfade-out starts here
  ctxTailS: number; // equal-power crossfade-out span (0 ⇒ last/no overlap)
  leadCtxS: number; // equal-power crossfade-in span from predecessor (0 ⇒ none)
  startsAtKickoff: boolean;
}

/**
 * Schedules the forward chunk gain envelope: an equal-power crossfade-in over
 * the predecessor's overlap tail (or a kickoff/edge fade-in when there is no
 * seam partner), unity through the body, then an equal-power crossfade-out over
 * the overlap tail (or a brief fade to silence on the last chunk). Any engine
 * that rejects the automation falls back to flat unity gain so playback can't
 * break.
 */
function applyForwardSeamGain(gain: GainNode, p: ForwardSeamGainParams) {
  const { t0, ctxTotalS, ctxNominalS, ctxTailS, leadCtxS, startsAtKickoff } = p;
  try {
    if (startsAtKickoff) {
      const fadeIn = Math.min(TRANSITION_FADE_IN_S, ctxTotalS / 2);
      gain.gain.setValueAtTime(0, t0);
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(1, t0 + fadeIn);
      else gain.gain.setValueAtTime(1, t0);
    } else if (leadCtxS > 0) {
      gain.gain.setValueCurveAtTime(
        EQUAL_POWER_FADE_IN_CURVE,
        t0,
        Math.min(leadCtxS, ctxTotalS / 2),
      );
    } else {
      // No seam partner (post-gap, or a legacy chunk decoded without overlap):
      // fade in from silence to mask a possible boundary discontinuity.
      const fadeIn = Math.min(CHUNK_EDGE_FADE_S, ctxTotalS / 2);
      gain.gain.setValueAtTime(0, t0);
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(1, t0 + fadeIn);
      else gain.gain.setValueAtTime(1, t0);
    }

    if (ctxTailS > 0) {
      gain.gain.setValueCurveAtTime(EQUAL_POWER_FADE_OUT_CURVE, t0 + ctxNominalS, ctxTailS);
    } else {
      const fadeOut = Math.min(CHUNK_EDGE_FADE_S, ctxTotalS / 2);
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(1, t0 + ctxTotalS - fadeOut);
        gain.gain.linearRampToValueAtTime(0, t0 + ctxTotalS);
      }
    }
  } catch {
    try {
      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(1, t0);
    } catch {
      /* no-op */
    }
  }
}

export interface WebAudioEngineOptions {
  getVfs?: () => IFileSystemAdapter | null;
  getAudioCacheVfsPath?: () => string | null;
}

export class WebAudioEngine implements IAudioEngine {
  // Full Web Audio implementation: scrubbing, peak extraction and metering.
  readonly capabilities: AudioEngineCapabilities = {
    scrubPreview: true,
    peaksExtraction: true,
    levelMetering: true,
  };
  private ctx: AudioContext | null = null;
  // How far ahead (in AudioContext seconds) the streaming loop is allowed to
  // pre-schedule source nodes for a given clip. Bigger = more decoder slack
  // (resilient to slow decodes) but more pinned AudioBuffers in memory.
  // 30s = up to ~6 chunks/clip in flight, ~12 MB stereo float32.
  private readonly schedulingLookaheadS = 30;
  private activeNodes = new Set<AudioBufferSourceNode>();
  private activeCleanups = new Map<AudioBufferSourceNode, () => void>();
  private activeGains = new Map<AudioBufferSourceNode, GainNode>();
  private activeScrubNodes = new Set<AudioBufferSourceNode>();
  private activeScrubCleanups = new Map<AudioBufferSourceNode, () => void>();
  private activeScrubGains = new Map<AudioBufferSourceNode, GainNode>();
  private masterGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private currentClips: AudioEngineClip[] = [];
  private destroyed = false;
  private readonly activePlaybackCollection: AudioNodeCollection = {
    nodes: this.activeNodes,
    cleanups: this.activeCleanups,
    gains: this.activeGains,
  };
  private readonly activeScrubCollection: AudioNodeCollection = {
    nodes: this.activeScrubNodes,
    cleanups: this.activeScrubCleanups,
    gains: this.activeScrubGains,
  };
  private readonly graphBuilder = new AudioGraphBuilder();
  private readonly chunkDecoder: AudioChunkDecoder;
  private readonly scheduler = new AudioScheduler({
    getContext: () => this.ctx,
    onScheduleLookahead: () => this.scheduleLookahead(),
    onStopNodes: (options) => this.stopAllNodes(options),
  });

  private currentMasterVolume = 1;
  private currentMonitorVolume = 1;
  private masterEffectInput: GainNode | null = null;
  private masterEffectGraph: { outputNode: AudioNode; destroy: () => Promise<void> } | null = null;
  private currentMasterAudioEffects: import('~/timeline/types').ClipEffect[] = [];
  private masterEffectGeneration = 0;
  private schedulingClipIds = new Set<string>();
  private scheduleGeneration = 0;
  private layoutGeneration = 0;

  private analyserNodes = new Map<string, AnalyserNode>(); // map by trackId or "master"
  private analyserData = new Float32Array(2048);

  constructor(options: WebAudioEngineOptions = {}) {
    this.chunkDecoder = new AudioChunkDecoder({
      getContext: () => this.ctx,
      collectPinnedBuffers: () => this.collectPinnedBuffers(),
      getVfs: options.getVfs,
      getCacheVfsPath: options.getAudioCacheVfsPath,
    });
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

  public async extractPeaks(
    fileHandle: FileSystemFileHandle,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number; durationS?: number },
  ): Promise<Float32Array[] | null> {
    return this.chunkDecoder.extractPeaks({ fileHandle, sourceKey, options });
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

      this.masterEffectInput = this.ctx.createGain();

      const masterAnalyser = this.ctx.createAnalyser();
      masterAnalyser.fftSize = 2048;

      // Chain: MasterEffectInput -> MasterGain -> Analyser -> MonitorGain -> Destination
      // When master effects are active they bridge MasterEffectInput to MasterGain.
      this.masterGain.connect(masterAnalyser);
      masterAnalyser.connect(this.monitorGain);
      this.monitorGain.connect(this.ctx.destination);
      this.masterEffectInput.connect(this.masterGain);

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
      logger.warn('Failed to set destination channelCount', err);
    }
  }

  async resumeContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch((err) => {
        logger.warn('resumeContext: Failed to resume', err);
      });
    }
  }

  async loadClips(clips: AudioEngineClip[]) {
    this.layoutGeneration += 1;
    const generation = this.layoutGeneration;
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
    this.startBackgroundPrefetch(clips, generation);
  }

  async updateTimelineLayout(clips: AudioEngineClip[]) {
    this.layoutGeneration += 1;
    const generation = this.layoutGeneration;
    this.currentClips = clips;
    this.cleanupCache();
    this.startBackgroundPrefetch(clips, generation);
    if (this.scheduler.isPlayingActive()) {
      // Re-evaluate playing nodes
      const currentTimeUs = this.getCurrentTimeUs();
      this.stopAllNodes();
      this.scheduler.resetScheduledClips();
      void this.play(currentTimeUs, this.scheduler.getGlobalSpeed());
    }
  }

  private startBackgroundPrefetch(clips: AudioEngineClip[], generation: number) {
    void this.chunkDecoder
      .prefetchHeadChunks(clips, {
        shouldContinue: () => generation === this.layoutGeneration && !this.destroyed,
        maxClips: 8,
        concurrency: 1,
      })
      .catch((error) => {
        if (generation !== this.layoutGeneration || this.destroyed) return;
        logger.warn('Background audio prefetch failed', error);
      });
  }

  private cleanupCache() {
    const activePaths = new Set(this.currentClips.map((c) => c.sourcePath).filter(Boolean));
    this.chunkDecoder.cleanup(activePaths);
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

  private async getDecodedChunks(clip: AudioEngineClip): Promise<AudioChunk[]> {
    const sourceKey = clip.sourcePath;
    if (!sourceKey) return [];

    const startOffsetS = clip.sourceStartUs / 1_000_000;
    const durationS = clip.sourceRangeDurationUs / 1_000_000;

    return this.chunkDecoder.getForRange({
      sourceKey,
      fileHandle: clip.fileHandle,
      startTimeS: startOffsetS,
      durationS,
    });
  }

  private buildClipPlaybackWindow(clip: AudioEngineClip, currentTimeS: number, speed: number) {
    return buildClipPlaybackWindow({
      clip,
      currentTimeS,
      speed,
      startAtS: this.ctx?.currentTime ?? 0,
      adjacentClips: this.getAdjacentClips(clip),
    });
  }

  private async playClipSegment(
    clip: AudioEngineClip,
    chunks: AudioChunk[],
    window: ClipPlaybackWindow,
    options?: {
      maxPlaybackDurationS?: number;
      nodeSet?: Set<AudioBufferSourceNode>;
      cleanupMap?: Map<AudioBufferSourceNode, () => void>;
      gainMap?: Map<AudioBufferSourceNode, GainNode>;
      requirePlayingActive?: boolean;
    },
  ) {
    if (!this.ctx || !this.masterGain || chunks.length === 0) return;
    if (options?.requirePlayingActive && !this.scheduler.isPlayingActive()) return;

    const currentSourceTimeS = getSourceTimeForClipLocal(window, window.currentClipLocalS);

    let safeBufferOffsetS = currentSourceTimeS;
    let safeDurationToPlayS = window.remainingInClipS * window.clipSpeed;

    if (typeof options?.maxPlaybackDurationS === 'number' && options.maxPlaybackDurationS > 0) {
      // maxPlaybackDurationS is a wall-clock cap, but safeDurationToPlayS counts
      // source (buffer) seconds. Convert the cap into source units via the
      // effective playback rate before clamping — otherwise previews on clips
      // with speed > 1 were cut short (the cap was applied as if 1x).
      const maxSourceDurationS = options.maxPlaybackDurationS * window.effectiveSpeed;
      safeDurationToPlayS = Math.min(safeDurationToPlayS, maxSourceDurationS);
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

    const { destroy: destroyEffects } = await this.graphBuilder.buildClipGraph({
      audioContext: this.ctx,
      sourceNode: clipInputNode,
      audioBalance: window.audioBalance,
      effects: clip.audioEffects ?? [],
      clipGain,
      masterGain: this.masterEffectInput!,
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
    const gainParam: AudioParam = clipGain.gain;

    gainParam.cancelScheduledValues?.(this.ctx.currentTime);
    gainParam.setValueAtTime?.(gainAtClipTime(t0), startAtS);

    if (window.fadeInS > 0 && t0 < window.fadeInS && t1 > 0) {
      const rampEndClipS = Math.min(window.fadeInS, t1);
      const rampEndAtS = clipLocalToCtxS(rampEndClipS);
      scheduleGainCurve({
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
      scheduleGainCurve({
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
    const chunkGainNodes: GainNode[] = [];

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

      const chunkGainNode = this.ctx.createGain();
      sourceNode.connect(chunkGainNode);
      chunkGainNode.connect(clipInputNode);

      const actualPlayDurationS = playDurationS / window.effectiveSpeed;
      const fadeDurationS = Math.min(CHUNK_EDGE_FADE_S, actualPlayDurationS / 2);
      if (fadeDurationS > 0) {
        chunkGainNode.gain.setValueAtTime(0, scheduledTimeS);
        chunkGainNode.gain.linearRampToValueAtTime(1, scheduledTimeS + fadeDurationS);
        chunkGainNode.gain.setValueAtTime(1, scheduledTimeS + actualPlayDurationS - fadeDurationS);
        chunkGainNode.gain.linearRampToValueAtTime(0, scheduledTimeS + actualPlayDurationS);
      } else {
        chunkGainNode.gain.setValueAtTime(1, scheduledTimeS);
      }

      sourceNode.start(scheduledTimeS, offsetInChunkS, playDurationS);

      chunkNodes.push(sourceNode);
      chunkGainNodes.push(chunkGainNode);

      scheduledTimeS += actualPlayDurationS;
      remainingToPlayS -= playDurationS;
      currentOffsetS += playDurationS;
    }

    const targetNodeSet = options?.nodeSet ?? this.activePlaybackCollection.nodes;
    const targetCleanupMap = options?.cleanupMap ?? this.activePlaybackCollection.cleanups;
    const targetGainMap = options?.gainMap ?? this.activePlaybackCollection.gains;

    const cleanupAll = async () => {
      await destroyEffects();
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
        targetGainMap.delete(node);
        try {
          node.disconnect();
        } catch {
          /* no-op */
        }
      }
      for (const gainNode of chunkGainNodes) {
        try {
          gainNode.disconnect();
        } catch {
          /* no-op */
        }
      }
    };

    if (chunkNodes.length === 0) {
      await cleanupAll();
      return;
    }

    const lastIndex = chunkNodes.length - 1;
    for (let i = 0; i < chunkNodes.length; i++) {
      const node = chunkNodes[i];
      if (!node) continue;
      targetNodeSet.add(node);
      targetGainMap.set(node, chunkGainNodes[i]!);

      node.onended = () => {
        targetNodeSet.delete(node);
        targetGainMap.delete(node);
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
        logger.warn('play: Failed to resume AudioContext', err);
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
      const reversed = isReversedClip(clip);

      let sourceTimeS: number;
      let sourceEndS: number;

      if (reversed) {
        const clipDurationS = clip.durationUs / 1_000_000;
        const sourceTimeRaw = sourceStartS + clipDurationS * clipSpeed - clipLocalS * clipSpeed;
        sourceTimeS = Math.max(0, sourceTimeRaw - LOOKAHEAD_S * clipSpeed);
        sourceEndS = Math.max(0, sourceTimeRaw);
      } else {
        sourceTimeS = sourceStartS + clipLocalS * clipSpeed;
        sourceEndS = sourceTimeS + LOOKAHEAD_S * clipSpeed;
      }

      const startChunkIndex = this.chunkDecoder.getChunkIndex(sourceTimeS);
      const endChunkIndex = this.chunkDecoder.getChunkIndex(Math.max(sourceTimeS, sourceEndS));
      const tasks: Array<Promise<unknown>> = [];
      for (let i = startChunkIndex; i <= endChunkIndex; i += 1) {
        tasks.push(
          this.chunkDecoder.ensureDecoded({
            sourceKey,
            fileHandle: clip.fileHandle,
            chunkIndex: i,
          }),
        );
      }
      await Promise.all(tasks);
    });

    await Promise.all(decodes);
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
        logger.warn('previewScrubForward: Failed to resume AudioContext', err);
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
      if (isReversedClip(clip)) continue; // Reverse audio muted in preview

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
          gainMap: this.activeScrubCollection.gains,
        },
      );
    }
  }

  stopScrubPreview() {
    stopNodeCollection(this.activeScrubNodes, this.activeScrubCleanups, {
      gains: this.activeScrubGains,
    });
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
        setValueAtTime?: (value: number, startTime: number) => AudioParam;
        setTargetAtTime?: (target: number, startTime: number, timeConstant: number) => AudioParam;
      };
      if (this.ctx && typeof gain.setTargetAtTime === 'function') {
        gain.setValueAtTime?.(gain.value, this.ctx.currentTime);
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

  setMasterAudioEffects(effects: import('~/timeline/types').ClipEffect[]) {
    if (!this.ctx || !this.masterEffectInput || !this.masterGain) return;
    const same =
      effects.length === this.currentMasterAudioEffects.length &&
      effects.every((e, i) => {
        const other = this.currentMasterAudioEffects[i];
        return e?.id === other?.id && e?.type === other?.type && e?.enabled === other?.enabled;
      });
    if (same) return;

    // Bump the generation so any in-flight async build from a previous call is
    // discarded instead of also connecting to masterGain (which would double the
    // signal and leak the older, never-destroyed graph on rapid toggles).
    this.masterEffectGeneration += 1;
    const generation = this.masterEffectGeneration;

    // Always detach masterEffectInput from whatever it currently feeds (the
    // direct bypass to masterGain or a prior effect graph's input) before
    // re-wiring, so we never end up connected to two destinations at once.
    try {
      this.masterEffectInput.disconnect();
    } catch {
      /* no-op */
    }
    if (this.masterEffectGraph) {
      void this.masterEffectGraph.destroy();
      this.masterEffectGraph = null;
    }

    this.currentMasterAudioEffects = effects.slice();

    if (effects.length === 0) {
      this.masterEffectInput.connect(this.masterGain);
      return;
    }

    void (async () => {
      if (!this.ctx || !this.masterEffectInput || !this.masterGain) return;
      try {
        const { outputNode, destroy } = await buildAudioEffectGraph({
          audioContext: this.ctx,
          sourceNode: this.masterEffectInput,
          effects,
        });
        // A newer setMasterAudioEffects() (or destroy()) ran while we awaited —
        // throw this graph away so only the latest one is wired up.
        if (generation !== this.masterEffectGeneration) {
          void destroy();
          return;
        }
        outputNode.connect(this.masterGain);
        this.masterEffectGraph = { outputNode, destroy };
      } catch (err) {
        logger.error('Failed to build master audio effect graph', err);
        if (generation === this.masterEffectGeneration) {
          this.masterEffectInput.connect(this.masterGain);
        }
      }
    })();
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
    if (isReversedClip(clip)) return false; // Reverse audio muted in preview

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

    const currentSourceTimeS = getSourceTimeForClipLocal(window, window.currentClipLocalS);
    const firstChunkIndex = this.chunkDecoder.getChunkIndex(Math.max(0, currentSourceTimeS));

    // Decode only the first chunk before starting playback. Subsequent
    // chunks are decoded and scheduled in the background as they become
    // available — that way long clips don't block the kickoff waiting for
    // every chunk in the range to come back from the worker.
    const firstChunk = await this.chunkDecoder.ensureDecoded({
      sourceKey,
      fileHandle: clip.fileHandle,
      chunkIndex: firstChunkIndex,
    });
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
    const lastChunkIndex = this.chunkDecoder.getChunkIndex(Math.max(0, sourceEndS - 1e-6));

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

  private async streamClipPlayback(args: {
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
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

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
    const clipInputNode = ctx.createGain();
    const clipGain = ctx.createGain();
    let destroyEffects: () => Promise<void>;
    try {
      const graph = await this.graphBuilder.buildClipGraph({
        audioContext: ctx,
        sourceNode: clipInputNode,
        audioBalance: window.audioBalance,
        effects: clip.audioEffects ?? [],
        clipGain,
        masterGain: this.masterEffectInput!,
        trackId: clip.trackId,
        analyserNodes: this.analyserNodes,
      });
      destroyEffects = graph.destroy;
    } catch (err) {
      logger.error('Failed to build clip audio graph', err);
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
      return;
    }

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
    const gainParam: AudioParam = clipGain.gain;

    gainParam.cancelScheduledValues?.(ctx.currentTime);
    gainParam.setValueAtTime?.(gainAtClipTime(t0), playStartS);

    if (window.fadeInS > 0 && t0 < window.fadeInS && t1 > 0) {
      const rampEndClipS = Math.min(window.fadeInS, t1);
      const rampEndAtS = clipLocalToCtxS(rampEndClipS);
      scheduleGainCurve({
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
      scheduleGainCurve({
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
    const targetGainMap = this.activePlaybackCollection.gains;
    const state = {
      scheduledCtxTimeS: playStartS,
      currentSourceTimeS,
      remainingToPlayS: totalSafeDurationS,
      chunkNodes: [] as AudioBufferSourceNode[],
      chunkGainNodes: [] as GainNode[],
      scheduledTotal: 0,
      endedTotal: 0,
      streamingDone: false,
      teardownDone: false,
      // Source-seconds of overlap that the previous chunk faded out over and
      // that this chunk must crossfade in over. 0 ⇒ no seam partner (kickoff,
      // post-gap, last chunk, or a legacy chunk decoded without overlap).
      pendingLeadOverlapS: 0,
    };

    const teardown = async () => {
      if (state.teardownDone) return;
      state.teardownDone = true;
      await destroyEffects();
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
        targetGainMap.delete(node);
        try {
          node.disconnect();
        } catch {
          /* no-op */
        }
      }
      for (const gainNode of state.chunkGainNodes) {
        try {
          gainNode.disconnect();
        } catch {
          /* no-op */
        }
      }
    };

    const maybeTeardown = async () => {
      if (state.streamingDone && state.endedTotal >= state.scheduledTotal) {
        await teardown();
      }
    };

    // If the decoder fell behind real time, advance the scheduling cursor so
    // the next source plays at the position the clock thinks we should be at.
    // We drop the audio that "should have played" during the gap — silence is
    // preferable to losing video/audio sync.
    const compensateForRealTimeGap = () => {
      if (!ctx) return;
      const ctxNow = ctx.currentTime;
      if (state.scheduledCtxTimeS >= ctxNow) return;
      const lostCtxS = ctxNow - state.scheduledCtxTimeS;
      const lostSourceS = lostCtxS * window.effectiveSpeed;
      // The next chunk no longer abuts the previous one's faded tail, so it
      // must fade in from silence rather than crossfade.
      state.pendingLeadOverlapS = 0;
      state.scheduledCtxTimeS = ctxNow;
      state.currentSourceTimeS += lostSourceS;
      state.remainingToPlayS = Math.max(0, state.remainingToPlayS - lostSourceS);
    };

    // Wires a scheduled source+gain into the bookkeeping/teardown maps.
    const registerSource = (sourceNode: AudioBufferSourceNode, chunkGainNode: GainNode) => {
      state.chunkNodes.push(sourceNode);
      state.chunkGainNodes.push(chunkGainNode);
      state.scheduledTotal += 1;
      targetNodeSet.add(sourceNode);
      targetGainMap.set(sourceNode, chunkGainNode);
      targetCleanupMap.set(sourceNode, teardown);
      sourceNode.onended = () => {
        targetNodeSet.delete(sourceNode);
        targetCleanupMap.delete(sourceNode);
        targetGainMap.delete(sourceNode);
        state.endedTotal += 1;
        void maybeTeardown();
      };
    };

    const scheduleSource = (chunk: AudioChunk) => {
      compensateForRealTimeGap();
      if (state.remainingToPlayS <= 0) return;

      const speed = window.effectiveSpeed;
      const chunkStartS = chunk.startTimeS;
      const chunkEndS = chunk.startTimeS + chunk.durationS;
      const startsAtKickoff =
        Math.abs(state.scheduledCtxTimeS - this.scheduler.getPlaybackStartCtxTimeS()) < 1e-4;

      // Forward: advance the cursor only by the nominal content and play the
      // decoded overlap tail at an equal-power fade so the next chunk crossfades
      // in over the same source region (no dip-to-silence at the seam).
      if (state.currentSourceTimeS >= chunkEndS) return;
      const plan = planForwardChunkPlayback({
        chunkStartS,
        chunkDurationS: chunk.durationS,
        chunkNominalDurationS: chunk.nominalDurationS,
        currentSourceTimeS: state.currentSourceTimeS,
        remainingToPlayS: state.remainingToPlayS,
        overlapS: SEAM_CROSSFADE_S,
      });
      if (plan.playDurationS <= 0) return;

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = chunk.buffer;
      if (sourceNode.playbackRate) sourceNode.playbackRate.value = speed;
      const chunkGainNode = ctx.createGain();
      sourceNode.connect(chunkGainNode);
      chunkGainNode.connect(clipInputNode);

      const t0 = state.scheduledCtxTimeS;
      const ctxNominalS = plan.playDurationS / speed;
      const ctxTailS = plan.tailOverlapS / speed;
      const ctxTotalS = plan.totalPlayS / speed;
      const leadCtxS = state.pendingLeadOverlapS / speed;

      applyForwardSeamGain(chunkGainNode, {
        t0,
        ctxTotalS,
        ctxNominalS,
        ctxTailS,
        leadCtxS,
        startsAtKickoff,
      });

      sourceNode.start(t0, plan.offsetInChunkS, plan.totalPlayS);
      registerSource(sourceNode, chunkGainNode);

      // The next chunk starts ctxTailS before this node's audio ends, so it
      // overlaps the faded tail; the cursor itself moves by the nominal amount.
      state.scheduledCtxTimeS = t0 + ctxNominalS;
      state.currentSourceTimeS += plan.playDurationS;
      state.remainingToPlayS -= plan.playDurationS;
      state.pendingLeadOverlapS = plan.tailOverlapS;
    };

    // Schedule the first chunk synchronously so audio can start at kickoff.
    scheduleSource(firstChunk);

    if (state.scheduledTotal === 0) {
      await teardown();
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
          if (!state.teardownDone) await teardown();
          return;
        }

        compensateForRealTimeGap();
        if (state.remainingToPlayS <= 0) break;

        const expectedChunkIdx = this.chunkDecoder.getChunkIndex(state.currentSourceTimeS);
        if (expectedChunkIdx > i) {
          i = expectedChunkIdx;
          continue;
        }

        const chunk = await this.chunkDecoder.ensureDecoded({
          sourceKey,
          fileHandle: clip.fileHandle,
          chunkIndex: i,
        });
        if (state.teardownDone) return;
        if (generation !== this.scheduleGeneration) {
          await teardown();
          return;
        }
        if (!this.scheduler.isPlayingActive()) {
          await teardown();
          return;
        }
        if (chunk) {
          scheduleSource(chunk);
        }
        i += 1;
      }

      state.streamingDone = true;
      await maybeTeardown();
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

  private stopAllNodes(options?: { fadeOutS?: number }) {
    stopNodeCollection(this.activeNodes, this.activeCleanups, {
      audioContext: this.ctx,
      fadeOutS: options?.fadeOutS,
      gains: this.activeGains,
    });
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.layoutGeneration += 1;
    this.scheduler.destroy();
    this.stopAllNodes();
    this.stopScrubPreview();
    if (this.masterEffectGraph) {
      void this.masterEffectGraph.destroy();
      this.masterEffectGraph = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.masterEffectInput = null;
    this.analyserNodes.clear();

    this.chunkDecoder.destroy();
  }
}
