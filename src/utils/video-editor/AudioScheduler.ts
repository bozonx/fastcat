export interface AudioSchedulerOptions {
  getContext: () => AudioContext | null;
  onScheduleLookahead: () => void;
  onStopNodes: () => void;
}

export class AudioScheduler {
  private readonly getContext: AudioSchedulerOptions['getContext'];
  private readonly onScheduleLookahead: AudioSchedulerOptions['onScheduleLookahead'];
  private readonly onStopNodes: AudioSchedulerOptions['onStopNodes'];
  private isPlaying = false;
  private baseTimeS = 0;
  private playbackContextTimeS = 0;
  private globalSpeed = 1;
  private scheduledClipIds = new Set<string>();
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AudioSchedulerOptions) {
    this.getContext = options.getContext;
    this.onScheduleLookahead = options.onScheduleLookahead;
    this.onStopNodes = options.onStopNodes;
  }

  async play(timeUs: number, speed = 1) {
    this.isPlaying = true;
    this.globalSpeed = speed;
    this.baseTimeS = timeUs / 1_000_000;
    this.scheduledClipIds.clear();

    const ctx = this.getContext();
    if (!ctx) {
      return;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume().catch((err) => {
        console.warn('[AudioEngine] play: Failed to resume AudioContext', err);
      });
    }

    this.playbackContextTimeS = ctx.currentTime;

    if (this.globalSpeed > 0) {
      this.startLookahead();
    }
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
      return;
    }

    this.onStopNodes();
    this.stopLookahead();
    this.scheduledClipIds.clear();
    this.baseTimeS = currentTimeS;
    this.playbackContextTimeS = ctx.currentTime;

    if (this.globalSpeed > 0) {
      this.startLookahead();
    }
  }

  seek(timeUs: number) {
    if (!this.isPlaying) {
      return;
    }

    this.onStopNodes();
    this.scheduledClipIds.clear();
    this.baseTimeS = timeUs / 1_000_000;

    const ctx = this.getContext();
    if (!ctx) {
      return;
    }

    this.playbackContextTimeS = ctx.currentTime;

    if (this.globalSpeed > 0) {
      this.onScheduleLookahead();
    }
  }

  destroy() {
    this.stopLookahead();
    this.scheduledClipIds.clear();
    this.isPlaying = false;
  }

  getCurrentTimeS(): number {
    const ctx = this.getContext();
    if (!this.isPlaying || !ctx) {
      return this.baseTimeS;
    }

    return this.baseTimeS + (ctx.currentTime - this.playbackContextTimeS) * this.globalSpeed;
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
