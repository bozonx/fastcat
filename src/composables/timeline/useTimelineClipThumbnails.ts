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

/** Aspect ratio of stored thumbnail frames (width / height). */
const THUMB_ASPECT = TIMELINE_CLIP_THUMBNAILS.WIDTH / TIMELINE_CLIP_THUMBNAILS.HEIGHT;

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
  const imageUrlsToRevoke = new Set<string>();

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
   * Display width of one thumbnail tile.
   *
   * The tile is rendered at its natural aspect ratio (height = clip row height,
   * width = height × THUMB_ASPECT). When the zoom is large enough that one
   * interval spans more pixels than the natural width the tile is stretched to
   * fill the interval slot instead, so there are never gaps between tiles.
   */
  const tileDisplayWidthPx = computed(() => {
    const h = options.clipHeightPx.value;
    if (!h || h <= 0) return pxPerThumbnail.value;
    const naturalWidth = h * THUMB_ASPECT;
    return Math.max(naturalWidth, pxPerThumbnail.value);
  });

  const sortedKeys = computed(() => {
    return Array.from(thumbnailsBySecond.value.keys()).sort((a, b) => a - b);
  });

  /**
   * Virtual thumbnail tiles: only tiles that intersect the visible viewport
   * are returned, so we never render hundreds of off-screen <img> elements.
   *
   * Coordinate system of leftPx is relative to the strip container which
   * starts at -trimOffsetPx (i.e. at source time = 0).
   */
  const thumbnailTiles = computed<ThumbnailTile[]>(() => {
    const pxPerThumb = pxPerThumbnail.value;
    if (!Number.isFinite(pxPerThumb) || pxPerThumb <= 0) return [];

    const tileW = tileDisplayWidthPx.value;
    if (!Number.isFinite(tileW) || tileW <= 0) return [];

    const map = thumbnailsBySecond.value;
    if (map.size === 0) return [];

    const keys = sortedKeys.value;
    if (keys.length === 0) return [];

    // Convert viewport bounds to strip-local coordinates.
    // clipStartPx is the left edge of the clip in the timeline coordinate space.
    // The strip starts at clipStartPx - trimOffsetPx.
    const stripStartInTimeline = options.clipStartPx.value - trimOffsetPx.value;
    const visibleLeft = options.scrollLeft.value - stripStartInTimeline;
    const visibleRight = visibleLeft + Math.max(0, options.viewportWidth.value);

    // First tile index whose right edge can reach the visible area:
    //   tileRight = (index + 1) * tileW >= visibleLeft  →  index >= visibleLeft/tileW - 1
    const firstIdx = Math.max(0, Math.floor(visibleLeft / tileW) - 1);
    // Last tile index whose left edge is still within visible area:
    //   tileLeft = index * tileW <= visibleRight
    const lastIdx = Math.ceil(visibleRight / tileW);

    const tiles: ThumbnailTile[] = [];

    for (let idx = firstIdx; idx <= lastIdx; idx++) {
      // Map tile index → source time key (nearest available at interval step)
      const sourceSecond = idx * intervalSeconds;

      let url = map.get(sourceSecond);

      // Find the closest available thumbnail key that is <= sourceSecond
      if (!url && keys.length > 0) {
        let low = 0;
        let high = keys.length - 1;
        let bestKey = keys[0] as number; // fallback to the minimum key

        while (low <= high) {
          const mid = (low + high) >> 1;
          const midKey = keys[mid];
          if (midKey !== undefined && midKey <= sourceSecond) {
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
        leftPx: idx * pxPerThumb,
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
          imageUrlsToRevoke.add(path);
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

    for (const url of imageUrlsToRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    imageUrlsToRevoke.clear();
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
