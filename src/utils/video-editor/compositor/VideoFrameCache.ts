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
    this.evictIfNeeded();
    if (this.maxVideoFrameCacheBytes === 0) {
      this.clear();
    }
  }

  public get(key: string): CachedVideoFrameEntry | null {
    const entry = this.videoFrameCache.get(key);
    if (!entry) return null;
    this.videoFrameCache.delete(key);
    this.videoFrameCache.set(key, entry);
    return entry;
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
      try {
        oldest.frame.close();
      } catch {
        // ignore
      }
    }

    if (this.videoFrameCacheSizeBytes < 0) {
      this.videoFrameCacheSizeBytes = 0;
    }
  }
}

export function resolveClipFrameRate(clip: VideoFrameCacheClipLike): number {
  const clipFrameRate = Number(clip.frameRate);
  if (Number.isFinite(clipFrameRate) && clipFrameRate > 0) {
    return clipFrameRate;
  }
  return 30;
}

export function computeFrameIndex(clip: VideoFrameCacheClipLike, sampleTimeS: number): number {
  const safeTimeS = Number.isFinite(sampleTimeS) ? Math.max(0, sampleTimeS) : 0;
  const originS =
    typeof clip.firstTimestampS === 'number' && Number.isFinite(clip.firstTimestampS)
      ? Math.max(0, clip.firstTimestampS)
      : 0;
  const frameRate = resolveClipFrameRate(clip);
  const relativeTimeS = Math.max(0, safeTimeS - originS);
  return Math.max(0, Math.round(relativeTimeS * frameRate));
}

export function buildVideoFrameCacheKey(clip: Pick<VideoFrameCacheClipLike, 'itemId'>, frameIndex: number): string {
  return `${clip.itemId}:${frameIndex}`;
}

export function estimateVideoFrameSizeBytes(frame: VideoFrame, width: number, height: number): number {
  const codedWidth = Math.max(1, Math.round(Number((frame as any).codedWidth) || width || 1));
  const codedHeight = Math.max(1, Math.round(Number((frame as any).codedHeight) || height || 1));
  return codedWidth * codedHeight * 4;
}
