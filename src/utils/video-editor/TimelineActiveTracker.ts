export interface TimelineActiveTrackerAccessors<TClip> {
  getId: (clip: TClip) => string;
  getStartTicks: (clip: TClip) => number;
  getEndTicks: (clip: TClip) => number;
}

export interface TimelineActiveTrackerUpdateParams<TClip> {
  clips: readonly TClip[];
  timeTicks: number;
  /**
   * @deprecated Ignored. The tracker keeps its own `lastTimeTicks` internally so the
   * forward/backward decision can never desync from `activeClips`/`nextClipStartIndex`.
   * Passing the externally tracked render time (which only advances on a successful
   * present) made a render that aborted before presenting leave the tracker pointing
   * at the wrong direction, stranding the previously active clip on screen.
   */
  lastTimeTicks?: number;
  onDeactivate?: (clip: TClip) => void;
}

export interface TimelineActiveTrackerUpdateResult<TClip> {
  activeClips: TClip[];
  activeChanged: boolean;
}

export class TimelineActiveTracker<TClip> {
  private activeClips: TClip[] = [];
  private nextClipStartIndex = 0;
  // Authoritative "where the playhead was last evaluated", committed together with
  // activeClips/nextClipStartIndex at the end of every update(). Kept internal so it
  // can never drift from the rest of the tracker state (the caller's render time only
  // advances when a frame actually presents, which is not guaranteed).
  private lastTimeTicks = 0;

  constructor(private readonly accessors: TimelineActiveTrackerAccessors<TClip>) {}

  reset() {
    this.activeClips = [];
    this.nextClipStartIndex = 0;
    this.lastTimeTicks = 0;
  }

  /** Clips active as of the last {@link update} (live reference — do not mutate). */
  getActiveClips(): readonly TClip[] {
    return this.activeClips;
  }

  update(
    params: TimelineActiveTrackerUpdateParams<TClip>,
  ): TimelineActiveTrackerUpdateResult<TClip> {
    const { clips, timeTicks, onDeactivate } = params;

    if (clips.length === 0) {
      this.reset();
      return { activeClips: this.activeClips, activeChanged: false };
    }

    const { getStartTicks, getEndTicks } = this.accessors;
    const { getId } = this.accessors;

    const movingForward = timeTicks >= this.lastTimeTicks;
    let activeChanged = false;

    if (!movingForward) {
      const prevActive = this.activeClips;
      const nextStartIndex = this.findNextStartIndex(clips, timeTicks);
      const nextActive: TClip[] = [];

      for (let i = 0; i < nextStartIndex; i += 1) {
        const clip = clips[i];
        if (!clip) continue;
        const startTicks = getStartTicks(clip);
        const endTicks = getEndTicks(clip);
        if (timeTicks >= startTicks && timeTicks < endTicks) {
          nextActive.push(clip);
        } else {
          onDeactivate?.(clip);
        }
      }

      if (prevActive.length > 0) {
        const nextActiveIds = new Set(nextActive.map((c) => getId(c)));
        for (const clip of prevActive) {
          if (!nextActiveIds.has(getId(clip))) {
            onDeactivate?.(clip);
          }
        }
      }

      this.activeClips = nextActive;
      this.nextClipStartIndex = nextStartIndex;
      activeChanged = true;
    } else {
      while (this.nextClipStartIndex < clips.length) {
        const nextClip = clips[this.nextClipStartIndex];
        if (!nextClip || getStartTicks(nextClip) > timeTicks) break;
        this.activeClips.push(nextClip);
        this.nextClipStartIndex += 1;
        activeChanged = true;
      }

      if (this.activeClips.length > 0) {
        const nextActive: TClip[] = [];
        for (const clip of this.activeClips) {
          if (timeTicks < getEndTicks(clip)) {
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

    this.lastTimeTicks = timeTicks;
    return { activeClips: this.activeClips, activeChanged };
  }

  private findNextStartIndex(clips: readonly TClip[], timeTicks: number): number {
    const { getStartTicks } = this.accessors;

    let low = 0;
    let high = clips.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const clip = clips[mid];
      if (clip && getStartTicks(clip) <= timeTicks) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }
}
