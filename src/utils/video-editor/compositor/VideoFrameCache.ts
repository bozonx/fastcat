export interface CachedVideoFrameEntry {
  key: string;
  clipId: string;
  frameIndex: number;
  frame: VideoFrame;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface VideoFrameCacheClipLike {
  itemId: string;
  frameRate?: number;
  firstTimestampS?: number;
}

export class VideoFrameCache {
  private maxVideoFrameCacheBytes: number;
  private videoFrameCache = new Map<string, CachedVideoFrameEntry>();
  private videoFrameCacheSizeBytes = 0;

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
      this.videoFrameCache.delete(key);
      this.videoFrameCacheSizeBytes -= entry.sizeBytes;
      if (this.videoFrameCacheSizeBytes < 0) {
        this.videoFrameCacheSizeBytes = 0;
      }
      return null;
    }

    this.videoFrameCache.delete(key);
    this.videoFrameCache.set(key, entry);
    return entry;
  }

  public delete(key: string): boolean {
    const entry = this.videoFrameCache.get(key);
    if (!entry) return false;
    this.videoFrameCache.delete(key);
    this.videoFrameCacheSizeBytes -= entry.sizeBytes;
    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
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
      try {
        existing.frame.close();
      } catch {
        // ignore
      }
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
    this.videoFrameCacheSizeBytes = 0;
  }

  private evictIfNeeded() {
    while (
      this.videoFrameCacheSizeBytes > this.maxVideoFrameCacheBytes &&
      this.videoFrameCache.size > 0
    ) {
      const oldestKey = this.videoFrameCache.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      const oldest = this.videoFrameCache.get(oldestKey);
      this.videoFrameCache.delete(oldestKey);
      if (!oldest) continue;
      this.videoFrameCacheSizeBytes -= oldest.sizeBytes;
      // Skip close() for already-closed frames (they don't hold GPU memory).
      const closed = !!(oldest.frame as { closed?: boolean }).closed;
      if (!closed) {
        try {
          oldest.frame.close();
        } catch {
          // ignore
        }
      }
    }

    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
  }
}

export function resolveClipFrameRate(clip: VideoFrameCacheClipLike): number | null {
  const clipFrameRate = Number(clip.frameRate);
  if (Number.isFinite(clipFrameRate) && clipFrameRate > 0) {
    return clipFrameRate;
  }
  return null;
}

// Without a known frame rate, key the cache by exact sampleTime in microseconds:
// distinct sampleTimeS values never collide. With a known frame rate we map the
// time to the SOURCE FRAME displayed at it — `floor(t * fps)` — so the key matches
// the sample-and-hold frame the sink actually returns for that time. (Rounding to
// the *nearest* frame instead put the bucket boundary at the half-frame mark, where
// float noise flips it: two adjacent output times could collide on one key and the
// later one would get a cache hit returning the earlier frame — a duplicate — while
// the skipped frame never showed. That surfaced as a periodic fps dip on export at
// non-frame-aligned phases, the web twin of the native `frame_at` boundary bug.)
// The small epsilon keeps a time landing exactly on a frame boundary from floating
// just under it and bucketing into the previous frame.
export function computeFrameIndex(clip: VideoFrameCacheClipLike, sampleTimeS: number): number {
  const safeTimeS = Number.isFinite(sampleTimeS) ? Math.max(0, sampleTimeS) : 0;
  const originS =
    typeof clip.firstTimestampS === 'number' && Number.isFinite(clip.firstTimestampS)
      ? Math.max(0, clip.firstTimestampS)
      : 0;
  const frameRate = resolveClipFrameRate(clip);
  if (frameRate === null) {
    return Math.max(0, Math.round(safeTimeS * 1_000_000));
  }
  const relativeTimeS = Math.max(0, safeTimeS - originS);
  return Math.max(0, Math.floor(relativeTimeS * frameRate + 1e-6));
}

export function buildVideoFrameCacheKey(
  clip: Pick<VideoFrameCacheClipLike, 'itemId'>,
  frameIndex: number,
): string {
  return `${clip.itemId}:${frameIndex}`;
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
