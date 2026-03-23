import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { useMediaStore } from '~/stores/media.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { isSvgFilename } from '~/utils/svg';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { fileThumbnailGenerator, getFileThumbnailHash } from '~/utils/file-thumbnail-generator';

export interface ThumbnailTile {
  key: number;
  url: string;
  leftPx: number;
  widthPx: number;
}

/** Fallback aspect ratio (16:9) when video metadata is not yet available. */
const DEFAULT_THUMB_ASPECT = 16 / 9;

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
  const fileManager = useFileManager();

  let isUnmounted = false;

  const intervalSeconds = TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
  const intervalUs = intervalSeconds * 1_000_000;

  const isGenerating = ref(false);
  const thumbnailsBySecond = ref(new Map<number, string>());

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
    const meta = mediaStore.mediaMetadata[url];
    if (meta) {
      return !meta.video && !meta.audio;
    }
    if (isSvgFilename(url)) return true;
    const ext = url.split('.').pop()?.toLowerCase();
    return ext ? ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif'].includes(ext) : false;
  });

  const imageUrl = ref('');

  watch(
    [isImage, fileUrl],
    async ([imageFlag, path]) => {
      if (imageFlag && path) {
        try {
          const file = await fileManager.vfs.getFile(path);
          if (!file) return;
          if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
          imageUrl.value = URL.createObjectURL(file);
        } catch (e) {
          console.error('Failed to load image for thumbnail:', e);
        }
      } else {
        if (imageUrl.value) {
          URL.revokeObjectURL(imageUrl.value);
          imageUrl.value = '';
        }
      }
    },
    { immediate: true },
  );

  const duration = computed(() => {
    return (options.item.value.sourceDurationUs || 0) / 1_000_000;
  });

  const clipHash = computed(() => {
    if (!fileUrl.value || !projectStore.currentProjectId) return '';
    return getClipThumbnailsHash({
      projectId: projectStore.currentProjectId,
      projectRelativePath: fileUrl.value,
    });
  });

  const fileThumbnailHash = computed(() => {
    if (!fileUrl.value || !projectStore.currentProjectId) return '';
    return getFileThumbnailHash({
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
    const meta = mediaStore.mediaMetadata[url];
    const v = meta?.video;
    if (v && v.displayWidth > 0 && v.displayHeight > 0) {
      return v.displayWidth / v.displayHeight;
    }
    return DEFAULT_THUMB_ASPECT;
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

    for (let idx = firstIdx; idx <= lastIdx; idx++) {
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

  async function generateNestedTimelinePreview() {
    if (!fileUrl.value || duration.value <= 0 || !projectStore.currentProjectId) return;

    const applySingleThumbnail = (url: string) => {
      const nextMap = new Map<number, string>();
      for (
        let second = 0;
        second < Math.max(1, Math.ceil(duration.value));
        second += intervalSeconds
      ) {
        nextMap.set(second, url);
      }
      if (!nextMap.has(0)) {
        nextMap.set(0, url);
      }
      thumbnailsBySecond.value = nextMap;
      isGenerating.value = false;
    };

    if (fileThumbnailHash.value) {
      fileThumbnailGenerator.addTask({
        id: fileThumbnailHash.value,
        projectId: projectStore.currentProjectId,
        projectRelativePath: fileUrl.value,
        onComplete: (url) => {
          if (isUnmounted) return;
          applySingleThumbnail(url);
        },
        onError: () => {
          if (isUnmounted) return;
          isGenerating.value = false;
        },
      });
    } else {
      isGenerating.value = false;
    }
  }

  const generate = () => {
    if (!fileUrl.value || duration.value <= 0 || !clipHash.value) return;
    if (!projectStore.currentProjectId) return;
    if (isImage.value) return;

    isGenerating.value = true;

    if (isNestedTimeline.value) {
      void generateNestedTimelinePreview();
      return;
    }

    thumbnailGenerator.addTask({
      id: clipHash.value,
      projectId: projectStore.currentProjectId,
      projectRelativePath: fileUrl.value,
      duration: duration.value,
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
        console.error('Thumbnail generation error:', err);
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
    if (clipHash.value) {
      thumbnailGenerator.cancelTask(clipHash.value);
    }

    if (imageUrl.value) {
      URL.revokeObjectURL(imageUrl.value);
      imageUrl.value = '';
    }
  });

  watch(fileUrl, () => {
    thumbnailsBySecond.value = new Map();
    if (!isImage.value) {
      generate();
    }
  });

  return {
    imageUrl,
    isGenerating,
    isImage,
    thumbnailTiles,
    trimOffsetPx,
  };
}
