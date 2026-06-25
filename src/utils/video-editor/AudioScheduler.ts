import { createDevLogger } from '~/utils/dev-logger';
const log = createDevLogger('AudioScheduler');
export interface AudioSchedulerOptions {
  getContext: () => AudioContext | null;
  onScheduleLookahead: () => void;
  onStopNodes: (options?: AudioSchedulerStopOptions) => void;
  kickoffLatencyS?: number;
}

export interface AudioSchedulerStopOptions {
  fadeOutS?: number;
}

// Time we hold off before audio actually starts emitting sound, to absorb
// worker-decode jitter and let the very first audio source schedule into the
// future. Web Audio source nodes scheduled at a ctx time in the past would
// glitch or get dropped; scheduling at ctx.currentTime + this delta gives us
// a stable kickoff for synchronous video/audio start.
const DEFAULT_KICKOFF_LATENCY_S = 0.05;
const TRANSITION_FADE_OUT_S = 0.02;

function normalizeKickoffLatency(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_KICKOFF_LATENCY_S;
  }

  return Math.min(0.15, Math.max(0.03, parsed));
}

export class AudioScheduler {
  private readonly getContext: AudioSchedulerOptions['getContext'];
  private readonly onScheduleLookahead: AudioSchedulerOptions['onScheduleLookahead'];
  private readonly onStopNodes: AudioSchedulerOptions['onStopNodes'];
  private readonly kickoffLatencyS: number;
  private isPlaying = false;
  private baseTimeS = 0;
  // ctx.currentTime at which the timeline clock starts ticking — set to a
  // small time in the future on play/seek/speed change so the engine has a
  // window to schedule the first source nodes synchronously.
  private playbackContextTimeS = 0;
  private globalSpeed = 1;
  private scheduledClipIds = new Set<string>();
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(options: AudioSchedulerOptions) {
    this.getContext = options.getContext;
    this.onScheduleLookahead = options.onScheduleLookahead;
    this.onStopNodes = options.onStopNodes;
    this.kickoffLatencyS = normalizeKickoffLatency(options.kickoffLatencyS);
  }

  async play(timeUs: number, speed = 1) {
    if (this.destroyed) {
      if (import.meta.dev) {
        log.warn('play() called on destroyed instance');
      }
      return;
    }
    this.isPlaying = true;
    this.globalSpeed = speed;
    this.baseTimeS = timeUs / 1_000_000;
    this.scheduledClipIds.clear();

    const ctx = this.getContext();
    if (!ctx) {
      // Без AudioContext (например в Tauri-сборке аудио отключено) — играем wall-clock'ом.
      this.playbackContextTimeS = this.wallClockS() + this.kickoffLatencyS;
      return;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume().catch((err) => {
        log.warn('[AudioEngine] play: Failed to resume AudioContext', err);
      });
    }

    this.playbackContextTimeS = ctx.currentTime + this.kickoffLatencyS;

    if (this.globalSpeed > 0) {
      this.startLookahead();
    }
  }

  private wallClockS(): number {
    return performance.now() / 1000;
  }

  stop() {
    this.isPlaying = false;
    this.stopLookahead();
    this.scheduledClipIds.clear();
    this.onStopNodes();
  }

  setGlobalSpeed(speed: number) {
    const parsed = Number(speed);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const currentTimeS = this.getCurrentTimeS();
    this.globalSpeed = parsed;

    if (!this.isPlaying) {
      return;
    }

    const ctx = this.getContext();
    if (!ctx) {
      // Без аудио (Tauri) — поддерживаем только обновление wall-clock базы.
      this.baseTimeS = currentTimeS;
      this.playbackContextTimeS = this.wallClockS() + this.kickoffLatencyS;
      return;
    }

    this.onStopNodes({ fadeOutS: TRANSITION_FADE_OUT_S });
    this.stopLookahead();
    this.scheduledClipIds.clear();
    this.baseTimeS = currentTimeS;
    this.playbackContextTimeS = ctx.currentTime + this.kickoffLatencyS;

    if (this.globalSpeed > 0) {
      this.startLookahead();
    }
  }

  seek(timeUs: number) {
    if (this.destroyed) {
      if (import.meta.dev) {
        log.warn('seek() called on destroyed instance');
      }
      return;
    }
    if (!this.isPlaying) {
      return;
    }

    this.onStopNodes({ fadeOutS: TRANSITION_FADE_OUT_S });
    this.scheduledClipIds.clear();
    this.baseTimeS = timeUs / 1_000_000;

    const ctx = this.getContext();
    if (!ctx) {
      // Wall-clock реанкоринг.
      this.playbackContextTimeS = this.wallClockS() + this.kickoffLatencyS;
      return;
    }

    this.playbackContextTimeS = ctx.currentTime + this.kickoffLatencyS;

    if (this.globalSpeed > 0) {
      this.onScheduleLookahead();
    }
  }

  destroy() {
    if (this.destroyed) {
      if (import.meta.dev) {
        log.warn('destroy() called twice');
      }
      return;
    }
    this.destroyed = true;
    this.stopLookahead();
    this.scheduledClipIds.clear();
    this.isPlaying = false;
  }

  /**
   * Re-anchor the timeline clock to an externally-provided time (e.g. from
   * the native audio engine via Tauri event). This does NOT reset scheduled
   * clips — it only adjusts baseTimeS so that getCurrentTimeS() matches the
   * external source.
   */
  syncTime(timeUs: number) {
    if (!this.isPlaying) return;
    const timeS = timeUs / 1_000_000;
    const ctx = this.getContext();
    const nowS = ctx ? ctx.currentTime : this.wallClockS();
    this.baseTimeS = timeS;
    this.playbackContextTimeS = nowS;
  }

  getCurrentTimeS(): number {
    if (!this.isPlaying) {
      return this.baseTimeS;
    }
    const ctx = this.getContext();
    const nowS = ctx ? ctx.currentTime : this.wallClockS();

    // Clamp at 0 — before kickoff the timeline is held at baseTimeS so the
    // monitor renders the requested frame instead of jumping backwards.
    const elapsed = Math.max(0, nowS - this.playbackContextTimeS);
    return this.baseTimeS + elapsed * this.globalSpeed;
  }

  getCurrentTimeUs(): number {
    return Math.round(this.getCurrentTimeS() * 1_000_000);
  }

  getGlobalSpeed() {
    return this.globalSpeed;
  }

  getBaseTimeS() {
    return this.baseTimeS;
  }

  // ctx.currentTime at which the timeline clock starts advancing. Returns the
  // last value set on play/seek/setGlobalSpeed; callers use this as the
  // synchronised kickoff point when scheduling BufferSourceNode.start().
  getPlaybackStartCtxTimeS() {
    return this.playbackContextTimeS;
  }

  isPlayingActive() {
    return this.isPlaying;
  }

  hasScheduledClip(clipId: string) {
    return this.scheduledClipIds.has(clipId);
  }

  markClipScheduled(clipId: string) {
    this.scheduledClipIds.add(clipId);
  }

  resetScheduledClips() {
    this.scheduledClipIds.clear();
  }

  private startLookahead() {
    if (this.destroyed) {
      if (import.meta.dev) {
        log.warn('startLookahead() called on destroyed instance');
      }
      return;
    }
    this.stopLookahead();
    this.onScheduleLookahead();
    this.scheduleTimer = setInterval(() => this.onScheduleLookahead(), 50);
  }

  private stopLookahead() {
    if (!this.scheduleTimer) {
      return;
    }

    clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
  }
}
