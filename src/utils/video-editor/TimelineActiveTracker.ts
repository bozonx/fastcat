export interface TimelineActiveTrackerAccessors<TClip> {
  getId: (clip: TClip) => string;
  getStartUs: (clip: TClip) => number;
  getEndUs: (clip: TClip) => number;
}

export interface TimelineActiveTrackerUpdateParams<TClip> {
  clips: readonly TClip[];
  timeUs: number;
  lastTimeUs: number;
  onDeactivate?: (clip: TClip) => void;
}

export interface TimelineActiveTrackerUpdateResult<TClip> {
  activeClips: TClip[];
  activeChanged: boolean;
}

export class TimelineActiveTracker<TClip> {
  private activeClips: TClip[] = [];
  private nextClipStartIndex = 0;

  constructor(private readonly accessors: TimelineActiveTrackerAccessors<TClip>) {}

  reset() {
    this.activeClips = [];
    this.nextClipStartIndex = 0;
  }

  update(
    params: TimelineActiveTrackerUpdateParams<TClip>,
  ): TimelineActiveTrackerUpdateResult<TClip> {
    const { clips, timeUs, lastTimeUs, onDeactivate } = params;

    if (clips.length === 0) {
      this.reset();
      return { activeClips: this.activeClips, activeChanged: false };
    }

    const { getStartUs, getEndUs } = this.accessors;

    const movingForward = timeUs >= lastTimeUs;
    let activeChanged = false;

    if (!movingForward) {
      const nextStartIndex = this.findNextStartIndex(clips, timeUs);
      const nextActive: TClip[] = [];

      for (let i = 0; i < nextStartIndex; i += 1) {
        const clip = clips[i];
        if (!clip) continue;
        const startUs = getStartUs(clip);
        const endUs = getEndUs(clip);
        if (timeUs >= startUs && timeUs < endUs) {
          nextActive.push(clip);
        } else {
          onDeactivate?.(clip);
        }
      }

      this.activeClips = nextActive;
      this.nextClipStartIndex = nextStartIndex;
      activeChanged = true;
    } else {
      while (this.nextClipStartIndex < clips.length) {
        const nextClip = clips[this.nextClipStartIndex];
        if (!nextClip || getStartUs(nextClip) > timeUs) break;
        this.activeClips.push(nextClip);
        this.nextClipStartIndex += 1;
        activeChanged = true;
      }

      if (this.activeClips.length > 0) {
        const nextActive: TClip[] = [];
        for (const clip of this.activeClips) {
          if (timeUs < getEndUs(clip)) {
            nextActive.push(clip);
          } else {
            onDeactivate?.(clip);
            activeChanged = true;
          }
        }
        if (nextActive.length !== this.activeClips.length) {
          this.activeClips = nextActive;
        }
      }
    }

    return { activeClips: this.activeClips, activeChanged };
  }

  private findNextStartIndex(clips: readonly TClip[], timeUs: number): number {
    const { getStartUs } = this.accessors;

    let low = 0;
    let high = clips.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const clip = clips[mid];
      if (clip && getStartUs(clip) <= timeUs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }
}
