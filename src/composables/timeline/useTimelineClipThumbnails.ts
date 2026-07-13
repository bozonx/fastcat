import { TICKS_PER_SECOND } from '~/utils/time';
import { createDevLogger } from '~/utils/dev-logger';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { useSafeObjectUrl } from '~/composables/useSafeObjectUrl';
import type { TimelineClipItem } from '~/timeline/types';
import { useMediaStore } from '~/stores/media.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { isSvgFilename } from '~/utils/svg';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import {
  getClipThumbnailsHash,
  getNestedTimelineThumbnailsHash,
  thumbnailGenerator,
} from '~/utils/thumbnail-generator';
const log = createDevLogger('useTimelineClipThumbnails');

export interface ThumbnailTile {
  key: number;
  url: string;
  leftPx: number;
  widthPx: number;
}

/** Fallback aspect ratio (16:9) when video metadata is not yet available. */
const DEFAULT_THUMB_ASPECT = 16 / 9;

export interface ThumbnailVideoAspectInput {
  width?: number;
  height?: number;
  displayWidth: number;
  displayHeight: number;
  rotation?: number;
}

export function resolveVisualVideoAspect(
  video: ThumbnailVideoAspectInput | null | undefined,
  fallback = DEFAULT_THUMB_ASPECT,
): number {
  if (!video || video.displayWidth <= 0 || video.displayHeight <= 0) {
    return fallback;
  }

  const displayAspect = video.displayWidth / video.displayHeight;
  const normalizedRotation = ((Math.round(video.rotation ?? 0) % 360) + 360) % 360;
  const isQuarterTurn = normalizedRotation === 90 || normalizedRotation === 270;

  if (!isQuarterTurn) {
    return displayAspect;
  }

  const codedWidth = Number(video.width);
  const codedHeight = Number(video.height);
  const displayMatchesCoded =
    Number.isFinite(codedWidth) &&
    Number.isFinite(codedHeight) &&
    codedWidth > 0 &&
    codedHeight > 0 &&
    Math.round(video.displayWidth) === Math.round(codedWidth) &&
    Math.round(video.displayHeight) === Math.round(codedHeight);

  return displayMatchesCoded ? video.displayHeight / video.displayWidth : displayAspect;
}

export interface UseTimelineClipThumbnailsOptions {
  item: Ref<TimelineClipItem>;
  /** Absolute scroll position of the timeline viewport (px). */
  scrollLeft: Ref<number>;
  /** Visible width of the timeline viewport (px). */
  viewportWidth: Ref<number>;
  /** Left position of the clip element in the timeline coordinate space (px). */
  clipStartPx: Ref<number>;
  /** Rendered height of the clip element (px) — used for aspect-ratio tile width. */
  clipHeightPx: Ref<number>;
}

export function useTimelineClipThumbnails(options: UseTimelineClipThumbnailsOptions) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();

  let isUnmounted = false;

  const intervalSeconds = TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
  const intervalUs = intervalSeconds * TICKS_PER_SECOND;

  const isGenerating = ref(false);
  // `shallowRef`, not `ref`: every write reassigns the whole Map (see below),
  // never mutates it in place, so shallow reactivity already drives the
  // `sortedKeys`/`thumbnailTiles` computeds. A deep `ref` would additionally
  // proxy the Map and reactive-track every `.get`/iteration on each clip's
  // strip — pure overhead that scales with the per-clip thumbnail count.
  const thumbnailsBySecond = shallowRef(new Map<number, string>());

  const clipThumbnailMode = computed(() => workspaceStore.userSettings.ui.clipThumbnailMode);

  const fileUrl = computed(() => {
    const item = options.item.value;
    if ((item.clipType === 'media' || item.clipType === 'timeline') && item.source) {
      return item.source.path;
    }
    return '';
  });

  const isNestedTimeline = computed(() => options.item.value.clipType === 'timeline');

  const isImage = computed(() => {
    const url = fileUrl.value;
    if (!url) return false;
    const meta = mediaStore.getCachedMetadata(url);
    if (meta) {
      return !meta.video && !meta.audio;
    }
    if (isSvgFilename(url)) return true;
    const ext = url.split('.').pop()?.toLowerCase();
    return ext ? ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif'].includes(ext) : false;
  });

  const { url: imageUrl, set: setImageUrl, revoke: revokeImageUrl } = useSafeObjectUrl();

  watch(
    [isImage, fileUrl],
    async ([imageFlag, path]) => {
      if (imageFlag && path) {
        try {
          const file = await fileManager.vfs.getFile(path);
          if (!file) return;
          setImageUrl(URL.createObjectURL(file));
        } catch (e) {
          log.error('Failed to load image for thumbnail:', e);
        }
      } else {
        revokeImageUrl();
      }
    },
    { immediate: true },
  );

  const duration = computed(() => {
    return (options.item.value.sourceDurationUs || 0) / TICKS_PER_SECOND;
  });

  // Content fingerprint (mtime) for a nested timeline's `.otio` file. Folded
  // into the cache key so editing the nested timeline invalidates its preview
  // frames. Null until resolved — clipHash stays empty so we don't key off a
  // stale/missing fingerprint.
  const nestedTimelineMtime = ref<number | null>(null);

  watch(
    [isNestedTimeline, fileUrl],
    async ([nested, path]) => {
      if (!nested || !path) {
        nestedTimelineMtime.value = null;
        return;
      }
      try {
        const file = await fileManager.vfs.getFile(path);
        nestedTimelineMtime.value = file?.lastModified ?? 0;
      } catch (e) {
        log.error('Failed to stat nested timeline for thumbnails:', e);
        nestedTimelineMtime.value = 0;
      }
    },
    { immediate: true },
  );

  const clipHash = computed(() => {
    if (!fileUrl.value || !projectStore.currentProjectId) return '';
    if (isNestedTimeline.value) {
      if (nestedTimelineMtime.value === null) return '';
      return getNestedTimelineThumbnailsHash({
        projectId: projectStore.currentProjectId,
        projectRelativePath: fileUrl.value,
        fingerprint: nestedTimelineMtime.value,
      });
    }
    return getClipThumbnailsHash({
      projectId: projectStore.currentProjectId,
      projectRelativePath: fileUrl.value,
    });
  });

  const pxPerThumbnail = computed(() => {
    return timeUsToPx(intervalUs, timelineStore.timelineZoom);
  });

  const trimOffsetPx = computed(() => {
    return timeUsToPx(options.item.value.sourceRange.startUs, timelineStore.timelineZoom);
  });

  /**
   * Aspect ratio of the actual video (displayWidth / displayHeight).
   * Uses media metadata when available so vertical videos get correct tile widths.
   */
  const videoAspect = computed(() => {
    const url = fileUrl.value;
    if (!url) return DEFAULT_THUMB_ASPECT;
    const meta = mediaStore.getCachedMetadata(url);
    return resolveVisualVideoAspect(meta?.video);
  });

  /**
   * Display width of one thumbnail tile.
   *
   * Always equals height × videoAspect so tiles never overlap and never have
   * gaps — they are placed consecutively regardless of timeline zoom. When the
   * clip row is taller (e.g. vertical zoom) tiles grow proportionally.
   */
  const tileDisplayWidthPx = computed(() => {
    const h = options.clipHeightPx.value;
    if (!h || h <= 0) return TIMELINE_CLIP_THUMBNAILS.WIDTH;
    return h * videoAspect.value;
  });

  const clipWidthPx = computed(() => {
    return Math.max(
      1,
      timeUsToPx(options.item.value.timelineRange.durationUs, timelineStore.timelineZoom),
    );
  });

  const pxPerSecond = computed(() => {
    return timeUsToPx(TICKS_PER_SECOND, timelineStore.timelineZoom);
  });

  const thumbnailGridStepSeconds = computed(() => {
    const pxPerSec = pxPerSecond.value;
    const tileW = tileDisplayWidthPx.value;
    if (!Number.isFinite(pxPerSec) || pxPerSec <= 0 || !Number.isFinite(tileW) || tileW <= 0) {
      return intervalSeconds;
    }

    const secondsPerTile = tileW / pxPerSec;
    const rawMultiplier = Math.max(1, Math.floor(secondsPerTile / intervalSeconds));
    const powerOfTwoMultiplier = 2 ** Math.floor(Math.log2(rawMultiplier));
    return intervalSeconds * Math.max(1, powerOfTwoMultiplier);
  });

  const requestedThumbnailTimes = computed(() => {
    if (clipThumbnailMode.value === 'none') return [];
    if (!fileUrl.value || duration.value <= 0 || isImage.value) return [];

    const pxPerSec = pxPerSecond.value;
    const clipW = clipWidthPx.value;
    if (!Number.isFinite(pxPerSec) || pxPerSec <= 0 || !Number.isFinite(clipW) || clipW <= 0) {
      return [];
    }

    const tileW = tileDisplayWidthPx.value;
    const overscanPx = Math.max(options.viewportWidth.value * 0.5, tileW * 4);

    const clipStartInViewportPx = options.scrollLeft.value - options.clipStartPx.value;
    const visibleStartLocalPx = Math.max(0, clipStartInViewportPx - overscanPx);
    const visibleEndLocalPx = Math.min(
      clipW,
      clipStartInViewportPx + options.viewportWidth.value + overscanPx,
    );

    if (visibleEndLocalPx < visibleStartLocalPx) return [];

    const sourceStartUs = options.item.value.sourceRange.startUs;

    if (clipThumbnailMode.value === 'edges') {
      const totalTiles = Math.max(1, Math.ceil(clipW / tileW));
      const firstIdx = Math.max(0, Math.floor(visibleStartLocalPx / tileW) - 1);
      const lastIdx = Math.ceil(visibleEndLocalPx / tileW);

      const times: number[] = [];
      const addedTimes = new Set<number>();

      for (let idx = firstIdx; idx <= lastIdx; idx++) {
        if (idx === 0 || idx === totalTiles - 1) {
          const sourceTimeSec = sourceStartUs / TICKS_PER_SECOND + (idx * tileW) / pxPerSec;
          const nearestSecond = Math.round(sourceTimeSec / intervalSeconds) * intervalSeconds;
          const roundedTime = Math.round(nearestSecond);
          if (roundedTime >= 0 && roundedTime <= duration.value && !addedTimes.has(roundedTime)) {
            times.push(roundedTime);
            addedTimes.add(roundedTime);
          }
        }
      }

      return times.sort((a, b) => a - b);
    }

    const sourceStartSec = Math.max(0, sourceStartUs / TICKS_PER_SECOND + visibleStartLocalPx / pxPerSec);
    const sourceEndSec = Math.min(
      duration.value,
      sourceStartUs / TICKS_PER_SECOND + visibleEndLocalPx / pxPerSec,
    );

    const step = thumbnailGridStepSeconds.value;
    const times: number[] = [];
    const first = Math.max(0, Math.floor(sourceStartSec / step) * step);

    for (let time = first; time <= sourceEndSec; time += step) {
      times.push(time);
    }

    if (times.length === 0 && sourceStartSec <= duration.value) {
      times.push(Math.floor(sourceStartSec / intervalSeconds) * intervalSeconds);
    }
    return times;
  });

  const sortedKeys = computed(() => {
    return Array.from(thumbnailsBySecond.value.keys()).sort((a, b) => a - b);
  });

  /**
   * Virtual thumbnail tiles: only tiles that intersect the visible viewport
   * are returned, so we never render hundreds of off-screen <img> elements.
   *
   * Tiles are aligned to trimOffsetPx so index 0 always starts at the clip's
   * left edge (first frame fully visible). Subsequent tiles follow at tileW
   * intervals — no gaps, no overlaps. Each tile looks up the nearest snapshot
   * on the fixed INTERVAL_SECONDS grid.
   *
   * leftPx is relative to the strip container which starts at -trimOffsetPx.
   */
  const thumbnailTiles = computed<ThumbnailTile[]>(() => {
    if (clipThumbnailMode.value === 'none') return [];

    const tileW = tileDisplayWidthPx.value;
    if (!Number.isFinite(tileW) || tileW <= 0) return [];

    const map = thumbnailsBySecond.value;
    if (map.size === 0) return [];

    const keys = sortedKeys.value;
    if (keys.length === 0) return [];

    const pxPerThumb = pxPerThumbnail.value;
    if (!Number.isFinite(pxPerThumb) || pxPerThumb <= 0) return [];

    // Pixels per second at current zoom.
    const pxPerSec = pxPerThumb / intervalSeconds;
    const trimOff = trimOffsetPx.value;

    // Strip-local visible bounds.
    // The strip div is offset left by -trimOff, so the clip left edge = strip position trimOff.
    const stripStartInTimeline = options.clipStartPx.value - trimOff;
    const visibleLeft = options.scrollLeft.value - stripStartInTimeline;
    const visibleRight = visibleLeft + Math.max(0, options.viewportWidth.value);

    // Tiles start at (trimOff + idx*tileW), index 0 = clip left edge.
    const firstIdx = Math.max(0, Math.floor((visibleLeft - trimOff) / tileW) - 1);
    const lastIdx = Math.ceil((visibleRight - trimOff) / tileW);

    const tiles: ThumbnailTile[] = [];
    const totalTiles = Math.max(1, Math.ceil(clipWidthPx.value / tileW));

    for (let idx = firstIdx; idx <= lastIdx; idx++) {
      if (clipThumbnailMode.value === 'edges') {
        if (idx !== 0 && idx !== totalTiles - 1) {
          continue;
        }
      }

      // Source time at this tile's left edge in seconds.
      const sourceTimeSec = (trimOff + idx * tileW) / pxPerSec;

      // Snap to the nearest snapshot on the fixed interval grid.
      const nearestSecond = Math.round(sourceTimeSec / intervalSeconds) * intervalSeconds;

      let url = map.get(nearestSecond);

      // Binary search for the closest available key <= nearestSecond.
      if (!url && keys.length > 0) {
        let low = 0;
        let high = keys.length - 1;
        let bestKey = keys[0] as number;

        while (low <= high) {
          const mid = (low + high) >> 1;
          const midKey = keys[mid];
          if (midKey !== undefined && midKey <= nearestSecond) {
            bestKey = midKey;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        url = map.get(bestKey);
      }

      if (!url) continue;

      tiles.push({
        key: idx,
        url,
        leftPx: trimOff + idx * tileW,
        widthPx: tileW,
      });
    }

    return tiles;
  });

  const generate = (requestedTimesS = requestedThumbnailTimes.value) => {
    if (clipThumbnailMode.value === 'none') return;
    if (!fileUrl.value || duration.value <= 0 || !clipHash.value) return;
    if (!projectStore.currentProjectId) return;
    if (isImage.value) return;
    if (requestedTimesS.length === 0) return;

    isGenerating.value = true;

    thumbnailGenerator.addTask({
      id: clipHash.value,
      projectId: projectStore.currentProjectId,
      projectRelativePath: fileUrl.value,
      // Nested timelines composite their `.otio` document per frame; plain
      // media clips decode their source file.
      sourceKind: isNestedTimeline.value ? 'timeline' : 'media',
      duration: duration.value,
      requestedTimesS,
      listenerKey: options.item.value.id,
      onProgress: (progress, path, time) => {
        if (isUnmounted) return;
        const secondKey = Math.round(time);
        const newMap = new Map(thumbnailsBySecond.value);
        if (!newMap.has(secondKey)) {
          newMap.set(secondKey, path);
          thumbnailsBySecond.value = newMap;
        }
      },
      onComplete: () => {
        if (isUnmounted) return;
        isGenerating.value = false;
      },
      onError: (err) => {
        if (isUnmounted) return;
        log.error('Thumbnail generation error:', err);
        isGenerating.value = false;
      },
    });
  };

  onMounted(() => {
    isUnmounted = false;
    if (
      (options.item.value.clipType === 'media' || options.item.value.clipType === 'timeline') &&
      !isImage.value
    ) {
      generate();
    }
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    revokeImageUrl();
    if (clipHash.value) {
      thumbnailGenerator.cancelTask(clipHash.value);
    }
  });

  watch(clipHash, (newHash, oldHash) => {
    if (oldHash) {
      thumbnailGenerator.cancelTask(oldHash);
    }
    thumbnailsBySecond.value = new Map();
    if (newHash && !isImage.value) {
      generate();
    }
  });

  watch(requestedThumbnailTimes, (times) => {
    if (times.length > 0) {
      generate(times);
    }
  });

  return {
    imageUrl,
    isGenerating,
    isImage,
    thumbnailTiles,
    trimOffsetPx,
    requestedThumbnailTimes,
    thumbnailGridStepSeconds,
  };
}
