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

export function useTimelineClipThumbnails(options: { item: Ref<TimelineClipItem> }) {
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

  /** Positioned img tiles built from thumbnailsBySecond. */
  const thumbnailTiles = computed<ThumbnailTile[]>(() => {
    const px = pxPerThumbnail.value;
    if (!Number.isFinite(px) || px <= 0) return [];

    const tiles: ThumbnailTile[] = [];
    for (const [second, url] of thumbnailsBySecond.value) {
      const thumbIndex = second / intervalSeconds;
      tiles.push({
        key: second,
        url,
        leftPx: thumbIndex * px,
        widthPx: px,
      });
    }

    tiles.sort((a, b) => a.key - b.key);
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
