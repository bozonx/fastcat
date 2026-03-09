import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { useMediaStore } from '~/stores/media.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { isSvgFilename } from '~/utils/svg';
import { pxToDeltaUs, timeUsToPx } from '~/utils/timeline/geometry';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { fileThumbnailGenerator, getFileThumbnailHash } from '~/utils/file-thumbnail-generator';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';

export interface TimelineThumbnailChunk {
  chunkIndex: number;
  startThumbIndex: number;
  endThumbIndex: number;
  thumbsCount: number;
  widthPx: number;
}

export function computeThumbsPerChunk(pxPerThumbnail: number): number {
  if (!Number.isFinite(pxPerThumbnail) || pxPerThumbnail <= 0) return 20;
  const chunkMaxPx = 3072;
  const raw = Math.floor(chunkMaxPx / pxPerThumbnail);
  return Math.max(8, Math.min(120, raw));
}

export function computeChunks(params: {
  isImage: boolean;
  totalThumbs: number;
  thumbsPerChunk: number;
  pxPerThumbnail: number;
}): TimelineThumbnailChunk[] {
  if (params.isImage) return [];
  if (params.totalThumbs === 0) return [];
  if (!Number.isFinite(params.thumbsPerChunk) || params.thumbsPerChunk <= 0) return [];
  if (!Number.isFinite(params.pxPerThumbnail) || params.pxPerThumbnail <= 0) return [];

  const count = Math.ceil(params.totalThumbs / params.thumbsPerChunk);
  return Array.from({ length: count }, (_, chunkIndex) => {
    const startThumbIndex = chunkIndex * params.thumbsPerChunk;
    const endThumbIndex = Math.min(params.totalThumbs, startThumbIndex + params.thumbsPerChunk);
    const thumbsCount = Math.max(0, endThumbIndex - startThumbIndex);
    const widthPx = thumbsCount * params.pxPerThumbnail;
    return {
      chunkIndex,
      startThumbIndex,
      endThumbIndex,
      thumbsCount,
      widthPx,
    };
  });
}

export function useTimelineClipThumbnails(options: { item: Ref<TimelineClipItem> }) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const mediaStore = useMediaStore();
  const fileManager = useFileManager();

  let isUnmounted = false;

  const intervalSeconds = TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
  const intervalUs = intervalSeconds * 1_000_000;

  const rootEl = ref<HTMLElement | null>(null);
  const isGenerating = ref(false);

  const thumbnailsBySecond = ref(new Map<number, string>());
  const imagePromisesByUrl = new Map<string, Promise<HTMLImageElement>>();
  const thumbAspectRatio = ref(16 / 9);

  const chunkEls = ref<(HTMLElement | null)[]>([]);
  const chunkCanvases = ref<(HTMLCanvasElement | null)[]>([]);
  const visibleChunks = ref(new Set<number>());

  let chunkObserver: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;

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

  const totalThumbs = computed(() => {
    if (!duration.value || duration.value <= 0) return 0;
    return Math.max(0, Math.ceil(duration.value / intervalSeconds));
  });

  const thumbsPerChunk = computed(() => {
    return computeThumbsPerChunk(pxPerThumbnail.value);
  });

  const chunks = computed(() => {
    return computeChunks({
      isImage: isImage.value,
      totalThumbs: totalThumbs.value,
      thumbsPerChunk: thumbsPerChunk.value,
      pxPerThumbnail: pxPerThumbnail.value,
    });
  });

  function getChunkIndexByThumbIndex(thumbIndex: number): number | null {
    if (!Number.isFinite(thumbIndex) || thumbIndex < 0) return null;
    const perChunk = thumbsPerChunk.value;
    if (!Number.isFinite(perChunk) || perChunk <= 0) return null;
    return Math.floor(thumbIndex / perChunk);
  }

  function setChunkEl(el: unknown, chunkIndex: number) {
    chunkEls.value[chunkIndex] = el instanceof HTMLElement ? el : null;
  }

  function setChunkCanvas(el: unknown, chunkIndex: number) {
    chunkCanvases.value[chunkIndex] = el instanceof HTMLCanvasElement ? el : null;
  }

  async function loadImage(url: string): Promise<HTMLImageElement> {
    const existing = imagePromisesByUrl.get(url);
    if (existing) return existing;

    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load thumbnail image'));
      img.src = url;
    });

    imagePromisesByUrl.set(url, p);
    return p;
  }

  function drawImageFitWidthCropHeight(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const imgRatio = img.width / img.height;
    const scaledHeight = w / imgRatio;

    if (scaledHeight <= h) {
      const dy = y + (h - scaledHeight) / 2;
      ctx.drawImage(img, x, dy, w, scaledHeight);
      return;
    }

    const visibleHeightInSource = img.width / (w / h);
    const sy = (img.height - visibleHeightInSource) / 2;
    ctx.drawImage(img, 0, sy, img.width, visibleHeightInSource, x, y, w, h);
  }

  async function drawChunk(chunkIndex: number) {
    const chunk = chunks.value.find((c) => c.chunkIndex === chunkIndex);
    if (!chunk) return;

    const canvas = chunkCanvases.value[chunkIndex];
    const root = rootEl.value;
    if (!canvas || !root) return;

    const cssHeight = Math.max(1, canvas.parentElement?.clientHeight || root.clientHeight);
    const chunkCssWidth = Math.max(1, Math.round(chunk.widthPx));

    const px = pxPerThumbnail.value;
    if (!Number.isFinite(px) || px <= 0) return;

    const baseTileWidthCss = Math.max(4, cssHeight * thumbAspectRatio.value);
    const step = Math.max(1, Math.ceil(baseTileWidthCss / px));

    const tileCssWidth = step * px;
    const cssWidth = chunkCssWidth + tileCssWidth;

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
    const targetHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < chunk.thumbsCount; i += step) {
      const thumbIndex = chunk.startThumbIndex + i;
      const secondKey = thumbIndex * intervalSeconds;
      const url = thumbnailsBySecond.value.get(secondKey);

      const xCss = i * px;
      const wCss = step * px;
      const xPx = Math.round(xCss * dpr);
      const wPx = Math.max(1, Math.round(wCss * dpr));

      if (!url) continue;

      try {
        const img = await loadImage(url);

        if (img.width > 0 && img.height > 0) {
          thumbAspectRatio.value = img.width / img.height;
        }

        drawImageFitWidthCropHeight(ctx, img, xPx, 0, wPx, canvas.height);
      } catch {
        // ignore
      }
    }
  }

  async function redrawVisibleChunks() {
    await nextTick();
    const toDraw = Array.from(visibleChunks.value.values());
    for (const idx of toDraw) {
      await drawChunk(idx);
    }
  }

  async function redrawMountedChunks() {
    await nextTick();
    for (const chunk of chunks.value) {
      const canvas = chunkCanvases.value[chunk.chunkIndex];
      if (!canvas) continue;
      await drawChunk(chunk.chunkIndex);
    }
  }

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
      });
    }

    try {
      const file = await fileManager.vfs.getFile(fileUrl.value);
      if (!file) return;
      const text = await file.text();
      const nestedDoc = parseTimelineFromOtio(text, {
        id: 'nested-preview',
        name: options.item.value.name,
        fps: 25,
      });

      const { buildVideoWorkerPayloadFromTracks } = await import('./useTimelineExport');

      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: nestedDoc.tracks,
        projectStore: projectStore as any,
      });
      const rawClips = builtVideo.payload;

      if (rawClips.length === 0) {
        isGenerating.value = false;
        return;
      }

      const width = Math.max(
        160,
        Math.round(Number(projectStore.projectSettings?.project?.width ?? 320)),
      );
      const height = Math.max(
        90,
        Math.round(Number(projectStore.projectSettings?.project?.height ?? 180)),
      );
      const previewTimeUs = Math.max(
        0,
        Math.min(
          Math.round(
            (options.item.value.sourceRange.startUs ?? 0) +
              options.item.value.sourceRange.durationUs / 2,
          ),
          Math.max(0, Math.round(duration.value * 1_000_000) - 1),
        ),
      );

      const { client } = getExportWorkerClient();
      setExportHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => projectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
          getFileHandleByPath: async (path: string) => projectStore.getFileHandleByPath(path),
          onExportProgress: () => {},
        }),
      );

      const blob = await client.extractFrameToBlob(previewTimeUs, width, height, rawClips, 0.8);
      if (!blob || isUnmounted) {
        isGenerating.value = false;
        return;
      }

      const url = URL.createObjectURL(blob);
      applySingleThumbnail(url);
    } catch (error) {
      console.error('Failed to generate nested timeline preview thumbnails:', error);
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

        const idx = Math.floor(secondKey / intervalSeconds);
        const chunkIndex = getChunkIndexByThumbIndex(idx);
        if (chunkIndex !== null) {
          const canvas = chunkCanvases.value[chunkIndex];
          if (canvas) {
            void drawChunk(chunkIndex);
          }
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
    chunkObserver?.disconnect();
    chunkObserver = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    visibleChunks.value.clear();

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

  watch(
    thumbnailsBySecond,
    () => {
      void redrawMountedChunks();
    },
    { flush: 'post' },
  );

  watch(
    [chunks, pxPerThumbnail, thumbAspectRatio],
    () => {
      void nextTick().then(() => {
        chunkObserver?.disconnect();
        visibleChunks.value.clear();

        chunkObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const el = entry.target as HTMLElement;
              const idxRaw = el.dataset['chunkIndex'];
              const idx = idxRaw ? Number(idxRaw) : NaN;
              if (!Number.isFinite(idx)) continue;

              if (entry.isIntersecting) {
                visibleChunks.value.add(idx);
                void drawChunk(idx);
              } else {
                visibleChunks.value.delete(idx);
              }
            }
          },
          {
            root: null,
            rootMargin: '200px',
            threshold: 0.01,
          },
        );

        for (const chunk of chunks.value) {
          const el = chunkEls.value[chunk.chunkIndex];
          if (el) chunkObserver.observe(el);
        }

        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(() => {
            void redrawVisibleChunks();
          });
        });
        if (rootEl.value) {
          resizeObserver.observe(rootEl.value);
        }

        void redrawMountedChunks();
      });
    },
    { immediate: true, flush: 'post' },
  );

  return {
    chunks,
    imageUrl,
    isGenerating,
    isImage,
    rootEl,
    setChunkCanvas,
    setChunkEl,
    trimOffsetPx,
  };
}
