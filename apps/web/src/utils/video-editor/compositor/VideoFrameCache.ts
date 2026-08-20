export interface CachedVideoFrameEntry {
  key: string;
  clipId: string;
  /** Source PTS of this frame quantized to milliseconds (`round(pts * 1000)`). */
  keyMs: number;
  timelineTimeTicks: number;
  frame: VideoFrame;
  sizeBytes: number;
  width: number;
  height: number;
}

/** Quantization of a source PTS (seconds) into the cache key domain — milliseconds. */
export const CACHE_KEY_HZ = 1000;

export class VideoFrameCache {
  private maxVideoFrameCacheBytes: number;
  private videoFrameCache = new Map<string, CachedVideoFrameEntry>();
  // Per-clip ASCENDING list of cached `keyMs` values. This is the web twin of the
  // native BTreeMap in `src-tauri/src/monitor/frame_cache.rs`: it lets `frameLe`
  // resolve "the frame with the greatest PTS ≤ target" without scanning the whole
  // cache, which is what makes the ms-grid key VFR-correct (the sink returns a
  // sample-and-hold frame by PTS, so the cache must be queried by PTS ordering, not
  // by an `floor(t * avg_fps)` bucket that collapses/splits frames on VFR sources).
  private clipKeys = new Map<string, number[]>();
  private videoFrameCacheSizeBytes = 0;
  private priorityTimeTicks = 0;

  constructor(maxVideoFrameCacheBytes: number) {
    this.maxVideoFrameCacheBytes = Math.max(0, Math.round(maxVideoFrameCacheBytes));
  }

  public applyLimitMb(cacheLimitMb?: number) {
    if (typeof cacheLimitMb !== 'number' || !Number.isFinite(cacheLimitMb)) {
      return;
    }

    const normalizedBytes = Math.max(0, Math.round(cacheLimitMb)) * 1024 * 1024;
    if (normalizedBytes === this.maxVideoFrameCacheBytes) {
      return;
    }

    this.maxVideoFrameCacheBytes = normalizedBytes;
    // evictIfNeeded already drains the cache when the limit becomes 0.
    this.evictIfNeeded();
  }

  public get(key: string): CachedVideoFrameEntry | null {
    const entry = this.videoFrameCache.get(key);
    if (!entry) return null;

    const closed = !!(entry.frame as { closed?: boolean }).closed;
    if (closed) {
      this.dropEntry(entry);
      return null;
    }

    this.videoFrameCache.delete(key);
    this.videoFrameCache.set(key, entry);
    return entry;
  }

  /**
   * The cached frame with the greatest source PTS ≤ `targetTimeS` (the sample-and-hold
   * frame the sink would return for that time), provided it has not fallen further
   * behind the target than `maxLagS`. Returns `null` on an empty clip, an le-miss, or
   * when the nearest floor is staler than the guard allows — in which case the caller
   * decodes the true frame. Mirrors the native `frame_le_with_max_lag`.
   */
  public frameLe(
    itemId: string,
    targetTimeS: number,
    maxLagS: number,
  ): CachedVideoFrameEntry | null {
    const keys = this.clipKeys.get(itemId);
    if (!keys || keys.length === 0) return null;

    // The query key is NOT clamped to 0 (unlike a stored frame's key): a target before
    // the first frame must floor-miss so the caller decodes, matching native `index_of`.
    const targetMs = Number.isFinite(targetTimeS) ? Math.round(targetTimeS * CACHE_KEY_HZ) : 0;
    const floorMs = this.floorKey(keys, targetMs);
    if (floorMs === null) return null;

    const maxLagMs = Math.max(0, Math.round((Number(maxLagS) || 0) * CACHE_KEY_HZ));
    if (targetMs - floorMs > maxLagMs) return null;

    return this.get(buildVideoFrameCacheKey({ itemId }, floorMs));
  }

  public setPriorityTimeTicks(timeTicks: number) {
    const next = Math.max(0, Math.round(Number(timeTicks) || 0));
    if (next === this.priorityTimeTicks) {
      return;
    }

    this.priorityTimeTicks = next;
    this.evictIfNeeded();
  }

  public delete(key: string): boolean {
    const entry = this.videoFrameCache.get(key);
    if (!entry) return false;
    this.dropEntry(entry);
    try {
      entry.frame.close();
    } catch {
      // ignore
    }
    return true;
  }

  public set(entry: CachedVideoFrameEntry) {
    if (this.maxVideoFrameCacheBytes <= 0) {
      try {
        entry.frame.close();
      } catch {
        // ignore
      }
      return;
    }

    const existing = this.videoFrameCache.get(entry.key);
    if (existing) {
      this.videoFrameCache.delete(entry.key);
      this.videoFrameCacheSizeBytes -= existing.sizeBytes;
      // Same key ⇒ same clipId+keyMs, so the sorted index already contains it.
      try {
        existing.frame.close();
      } catch {
        // ignore
      }
    } else {
      this.indexAdd(entry.clipId, entry.keyMs);
    }

    this.videoFrameCache.set(entry.key, entry);
    this.videoFrameCacheSizeBytes += entry.sizeBytes;
    this.evictIfNeeded();
  }

  public clearForClip(clipId: string) {
    for (const [key, entry] of this.videoFrameCache.entries()) {
      if (entry.clipId !== clipId) continue;
      this.videoFrameCache.delete(key);
      this.videoFrameCacheSizeBytes -= entry.sizeBytes;
      try {
        entry.frame.close();
      } catch {
        // ignore
      }
    }
    this.clipKeys.delete(clipId);

    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
  }

  public clear() {
    for (const entry of this.videoFrameCache.values()) {
      try {
        entry.frame.close();
      } catch {
        // ignore
      }
    }
    this.videoFrameCache.clear();
    this.clipKeys.clear();
    this.videoFrameCacheSizeBytes = 0;
  }

  /** Removes an entry from both the store and the per-clip sorted index. */
  private dropEntry(entry: CachedVideoFrameEntry) {
    this.videoFrameCache.delete(entry.key);
    this.videoFrameCacheSizeBytes -= entry.sizeBytes;
    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
    this.indexRemove(entry.clipId, entry.keyMs);
  }

  /** First index in ascending `keys` whose value is ≥ `value` (lower bound). */
  private lowerBound(keys: number[], value: number): number {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((keys[mid] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Greatest cached key ≤ `targetMs` in ascending `keys`, or null when none. */
  private floorKey(keys: number[], targetMs: number): number | null {
    const idx = this.lowerBound(keys, targetMs + 1);
    return idx > 0 ? (keys[idx - 1] as number) : null;
  }

  private indexAdd(clipId: string, keyMs: number) {
    const keys = this.clipKeys.get(clipId);
    if (!keys) {
      this.clipKeys.set(clipId, [keyMs]);
      return;
    }
    const idx = this.lowerBound(keys, keyMs);
    if (keys[idx] !== keyMs) {
      keys.splice(idx, 0, keyMs);
    }
  }

  private indexRemove(clipId: string, keyMs: number) {
    const keys = this.clipKeys.get(clipId);
    if (!keys) return;
    const idx = this.lowerBound(keys, keyMs);
    if (keys[idx] === keyMs) {
      keys.splice(idx, 1);
      if (keys.length === 0) {
        this.clipKeys.delete(clipId);
      }
    }
  }

  private evictIfNeeded() {
    if (
      this.videoFrameCacheSizeBytes > this.maxVideoFrameCacheBytes &&
      this.videoFrameCache.size > 0
    ) {
      // Rank every entry once and evict down the list until under the limit.
      // The ordering reproduces what repeated `chooseEvictionVictimTime` picks
      // (farthest from priority first; ties toward the larger time; among equal
      // times the earliest-inserted entry) without re-scanning the whole map per
      // evicted frame — the old loop was O(n²) when the limit shrank sharply.
      const priority = this.priorityTimeTicks;
      const ranked = Array.from(this.videoFrameCache.values(), (entry, index) => ({
        entry,
        index,
        time: Math.max(0, Math.round(Number(entry.timelineTimeTicks) || 0)),
      }));
      ranked.sort(
        (a, b) =>
          Math.abs(b.time - priority) - Math.abs(a.time - priority) ||
          b.time - a.time ||
          a.index - b.index,
      );

      for (const victim of ranked) {
        if (this.videoFrameCacheSizeBytes <= this.maxVideoFrameCacheBytes) break;
        this.dropEntry(victim.entry);
        // Skip close() for already-closed frames (they don't hold GPU memory).
        const closed = !!(victim.entry.frame as { closed?: boolean }).closed;
        if (!closed) {
          try {
            victim.entry.frame.close();
          } catch {
            // ignore
          }
        }
      }
    }

    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
  }
}

// Scrub-locality eviction pick: among cached frame times (ticks), the victim is the
// one FARTHEST from the priority/playhead time; ties resolve toward the LARGER
// time. This is the web twin of the native `choose_eviction_victim`
// (src-tauri/src/monitor/frame_cache.rs) and is pinned to it by the shared
// `shared/parity/frame-cache-eviction.cases.json` parity fixture. Returns the
// winning (normalized) time, or null for an empty input.
export function chooseEvictionVictimTime(times: number[], priorityTime: number): number | null {
  const priority = Math.max(0, Math.round(Number(priorityTime) || 0));
  let best: { time: number; distance: number } | null = null;
  for (const raw of times) {
    const time = Math.max(0, Math.round(Number(raw) || 0));
    const distance = Math.abs(time - priority);
    if (!best || distance > best.distance || (distance === best.distance && time > best.time)) {
      best = { time, distance };
    }
  }
  return best ? best.time : null;
}

// Cache-key domain: a source PTS (seconds) quantized to a MILLISECOND grid
// (`round(pts * 1000)`), an absolute position in the source. This is the web twin of
// the native cache key (src-tauri/src/monitor/frame_cache.rs): a millisecond grid
// (rather than `round(pts * avg_fps)`) never collapses adjacent frames on VFR
// sources, where the real inter-frame interval is not `1 / avg_fps`. Both the render
// path and the decode-ahead prewarm key by the DECODED sample's own PTS, so the two
// always agree on which bucket a frame lands in.
export function computeFrameKeyMs(ptsS: number): number {
  const safeS = Number.isFinite(ptsS) ? Math.max(0, ptsS) : 0;
  return Math.round(safeS * CACHE_KEY_HZ);
}

export function buildVideoFrameCacheKey(clip: { itemId: string }, keyMs: number): string {
  return `${clip.itemId}:${keyMs}`;
}

// AV-sync guard for `frameLe` (seconds): the cached floor frame is only trusted when
// it lags the target by no more than this. During dense forward playback / export the
// decode-ahead keeps the floor within ~one source interval, so it always passes; a
// scrub into an un-decoded region exceeds it and forces a fresh decode (which yields
// the exact sample-and-hold frame) instead of showing a stale one. Sized to the
// clip's average interval — `1.5 / fps` covers holds up to ~1.5 source frames — with
// a floor for unknown/near-zero rates. Mirrors the native monitor's max-lag policy.
export function resolveFrameLeMaxLagS(frameRate?: number): number {
  const fps = Number(frameRate);
  const perFrame = Number.isFinite(fps) && fps > 0 ? 1.5 / fps : 0;
  return Math.max(1 / 30, perFrame);
}

export function estimateVideoFrameSizeBytes(
  frame: VideoFrame,
  width: number,
  height: number,
): number {
  const codedWidth = Math.max(
    1,
    Math.round(Number((frame as { codedWidth?: unknown }).codedWidth) || width || 1),
  );
  const codedHeight = Math.max(
    1,
    Math.round(Number((frame as { codedHeight?: unknown }).codedHeight) || height || 1),
  );

  const frameWithAllocation = frame as {
    allocationSize?: (options?: { format?: string }) => number;
  };
  if (typeof frameWithAllocation.allocationSize === 'function') {
    try {
      const size = frameWithAllocation.allocationSize();
      if (Number.isFinite(size) && size > 0) {
        return Math.ceil(size * 1.2);
      }
    } catch {
      // ignore
    }
  }

  // Account for stride alignment (commonly 64 bytes) and GPU texture overhead
  const alignedWidth = Math.ceil(codedWidth / 64) * 64;
  return Math.ceil(alignedWidth * codedHeight * 4 * 1.5);
}
