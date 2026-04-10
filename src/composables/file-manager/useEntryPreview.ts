import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import yaml from 'js-yaml';
import {
  TEXT_EXTENSIONS,
  getMediaTypeFromFilename,
  getMimeTypeFromFilename,
} from '~/utils/media-types';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { computeDirectoryStats } from '~/utils/fs';
import type { TimelineDocument } from '~/timeline/types';
import type { FsEntry } from '~/types/fs';
import type { MediaMetadata } from '~/stores/media.store';
import { getBdPayload } from '~/types/bloggerdog';

export type PreviewMode = 'original' | 'proxy';
export type MediaType = 'image' | 'video' | 'audio' | 'text' | 'unknown' | null;

export type EntryPreviewInfo = {
  kind: 'file' | 'directory';
  name: string;
  path?: string;
  size?: number;
  createdAt?: number;
  lastModified?: number;
  mimeType?: string;
  container?: string;
  metadata?: unknown;
  ext?: string;
  filesCount?: number;
};

function computeTimelineSummary(doc: TimelineDocument) {
  const durationUs = selectTimelineDurationUs(doc);
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video').length;
  const audioTracks = doc.tracks.filter((t) => t.kind === 'audio').length;
  const clips = doc.tracks.reduce(
    (acc, t) => acc + t.items.filter((it) => it.kind === 'clip').length,
    0,
  );
  const version =
    typeof doc.metadata?.fastcat?.version === 'number' ? doc.metadata.fastcat.version : null;
  return { durationUs, videoTracks, audioTracks, clips, version };
}

export function useEntryPreview(params: {
  selectedFsEntry: Ref<FsEntry | null>;
  previewMode: Ref<PreviewMode>;
  hasProxy: Ref<boolean>;
  mediaStore: {
    getOrFetchMetadataByPath: (
      projectRelativePath: string,
      options?: { forceRefresh?: boolean },
    ) => Promise<MediaMetadata | null>;
  };
  proxyStore: { getProxyFile: (path: string) => Promise<File | null> };
  getFileByPath: (path: string) => Promise<File | null>;
  getMetadata?: (params: {
    file: File;
    entry: FsEntry;
    path: string;
  }) => Promise<MediaMetadata | null>;
  getDirectoryHandleByPath?: (path: string) => Promise<FileSystemDirectoryHandle | null>;
  onResetPreviewMode: (mode: 'original' | 'proxy') => void;
}) {
  const currentUrl = ref<string | null>(null);
  const mediaType = ref<MediaType>(null);
  const textContent = ref<string>('');
  const fileInfo = ref<EntryPreviewInfo | null>(null);
  const exifData = ref<unknown | null>(null);
  const imageDimensions = ref<{ width: number; height: number } | null>(null);
  const lineCount = ref<number | null>(null);
  const timelineDocSummary = ref<{
    durationUs: number;
    videoTracks: number;
    audioTracks: number;
    clips: number;
    version: number | null;
  } | null>(null);
  let loadRequestId = 0;

  const exifYaml = computed(() => {
    if (!exifData.value) return null;
    try {
      return yaml.dump(exifData.value, { indent: 2 });
    } catch {
      return String(exifData.value);
    }
  });

  const isUnknown = computed(() => mediaType.value === 'unknown');

  const ext = computed(() => {
    const entry = params.selectedFsEntry.value;
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const value = name.split('.').pop()?.toLowerCase() ?? '';
    return value && value !== name.toLowerCase() ? value : value;
  });

  const isOtio = computed(() => ext.value === 'otio');

  const metadataYaml = computed(() => {
    if (!fileInfo.value?.metadata) return null;
    try {
      return yaml.dump(fileInfo.value.metadata, { indent: 2 });
    } catch {
      return String(fileInfo.value.metadata);
    }
  });

  function applyResolvedState(next: {
    currentUrl: string | null;
    mediaType: MediaType;
    textContent: string;
    fileInfo: EntryPreviewInfo | null;
    exifData: unknown | null;
    imageDimensions: { width: number; height: number } | null;
    lineCount: number | null;
    timelineDocSummary: {
      durationUs: number;
      videoTracks: number;
      audioTracks: number;
      clips: number;
      version: number | null;
    } | null;
  }) {
    const previousUrl = currentUrl.value;
    currentUrl.value = next.currentUrl;
    mediaType.value = next.mediaType;
    textContent.value = next.textContent;
    fileInfo.value = next.fileInfo;
    exifData.value = next.exifData;
    imageDimensions.value = next.imageDimensions;
    lineCount.value = next.lineCount;
    timelineDocSummary.value = next.timelineDocSummary;

    if (previousUrl && previousUrl !== next.currentUrl) {
      URL.revokeObjectURL(previousUrl);
    }
  }

  async function resolvePreviewMediaState(
    entry: FsEntry | null,
    resolvedMediaType: MediaType,
    resolvedFileInfo: EntryPreviewInfo | null,
  ) {
    if (!entry || entry.kind !== 'file') {
      return {
        currentUrl: null,
        imageDimensions: null,
      };
    }

    try {
      let fileToPlay: File | null = null;

      if (params.previewMode.value === 'proxy' && params.hasProxy.value && entry.path) {
        fileToPlay = await params.proxyStore.getProxyFile(entry.path);
      }

      if (!fileToPlay && entry.path) {
        fileToPlay = await params.getFileByPath(entry.path);
      }

      if (!fileToPlay) {
        return {
          currentUrl: null,
          imageDimensions: null,
        };
      }

      let nextUrl: string | null = null;
      if (
        resolvedMediaType === 'video' ||
        resolvedMediaType === 'audio' ||
        (resolvedMediaType === 'image' &&
          (resolvedFileInfo?.metadata as any)?.image?.canDisplay !== false)
      ) {
        nextUrl = URL.createObjectURL(fileToPlay);
      }

      let nextImageDimensions: { width: number; height: number } | null = null;
      if (resolvedMediaType === 'image') {
        try {
          const bitmap = await createImageBitmap(fileToPlay);
          nextImageDimensions = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
        } catch {
          nextImageDimensions = null;
        }
      }

      return {
        currentUrl: nextUrl,
        imageDimensions: nextImageDimensions,
      };
    } catch (e) {
      console.error('Failed to load preview media:', e);
      return {
        currentUrl: null,
        imageDimensions: null,
      };
    }
  }

  async function loadPreviewMedia() {
    const requestId = ++loadRequestId;
    const entry = params.selectedFsEntry.value;
    const nextMediaType = mediaType.value;
    const nextFileInfo = fileInfo.value;
    const nextTextContent = textContent.value;
    const nextExifData = exifData.value;
    const nextLineCount = lineCount.value;
    const nextTimelineDocSummary = timelineDocSummary.value;
    const previewState = await resolvePreviewMediaState(entry, nextMediaType, nextFileInfo);

    if (requestId !== loadRequestId) {
      if (previewState.currentUrl) {
        URL.revokeObjectURL(previewState.currentUrl);
      }
      return;
    }

    applyResolvedState({
      currentUrl: previewState.currentUrl,
      mediaType: nextMediaType,
      textContent: nextTextContent,
      fileInfo: nextFileInfo,
      exifData: nextExifData,
      imageDimensions: previewState.imageDimensions,
      lineCount: nextLineCount,
      timelineDocSummary: nextTimelineDocSummary,
    });
  }

  watch(
    () => params.previewMode.value,
    () => {
      void loadPreviewMedia();
    },
  );

  watch(
    () => params.selectedFsEntry.value,
    async (entry) => {
      const requestId = ++loadRequestId;
      params.onResetPreviewMode('original');

      // Clear previous state immediately to avoid showing stale data during async load
      applyResolvedState({
        currentUrl: null,
        mediaType: null,
        textContent: '',
        fileInfo: null,
        exifData: null,
        imageDimensions: null,
        lineCount: null,
        timelineDocSummary: null,
      });

      if (!entry) {
        return;
      }

      if (entry.kind === 'directory') {
        let size = 0;
        let filesCount = entry.children?.filter((c) => c.kind === 'file').length ?? 0;

        if (entry.path && params.getDirectoryHandleByPath) {
          const handle = await params.getDirectoryHandleByPath(entry.path);
          if (handle) {
            const stats = await computeDirectoryStats(handle, { recursiveFilesCount: false });
            if (stats) {
              size = stats.size;
              filesCount = stats.filesCount;
            }
          }
        }

        if (size === 0 && typeof entry.size === 'number') {
          size = entry.size;
        }

        if (requestId !== loadRequestId) return;

        applyResolvedState({
          currentUrl: null,
          mediaType: null,
          textContent: '',
          fileInfo: {
            name: entry.name,
            kind: 'directory',
            path: entry.path,
            size,
            filesCount,
            lastModified: entry.lastModified,
            createdAt: entry.createdAt,
          },
          exifData: null,
          imageDimensions: null,
          lineCount: null,
          timelineDocSummary: null,
        });
        return;
      }

      try {
        const fileExt = entry.name.split('.').pop()?.toLowerCase() || '';
        const extBasedType = getMediaTypeFromFilename(entry.name);
        let nextMediaType: MediaType = null;
        if (extBasedType !== 'unknown') {
          nextMediaType = extBasedType === 'timeline' ? 'text' : extBasedType;
        }

        const file = await params.getFileByPath(entry.path);
        if (!file) return;
        if (requestId !== loadRequestId) return;

        const textExtensions = TEXT_EXTENSIONS;
        let nextTextContent = '';
        let nextLineCount: number | null = null;
        let nextTimelineDocSummary: {
          durationUs: number;
          videoTracks: number;
          audioTracks: number;
          clips: number;
          version: number | null;
        } | null = null;

        if (fileExt === 'otio' || extBasedType === 'timeline') {
          nextMediaType = 'text';
          try {
            const text = await file.text();
            if (requestId !== loadRequestId) return;
            nextLineCount = text.split('\n').length;
            const parsedDoc = parseTimelineFromOtio(text, {
              id: entry.path ?? 'unknown',
              name: entry.name,
              fps: 25,
            });
            nextTimelineDocSummary = computeTimelineSummary(parsedDoc);
          } catch {
            nextTimelineDocSummary = null;
          }
        } else if (extBasedType === 'image') {
          nextMediaType = 'image';
        } else if (extBasedType === 'video') {
          nextMediaType = 'video';
        } else if (extBasedType === 'audio') {
          nextMediaType = 'audio';
        } else if (extBasedType === 'text') {
          nextMediaType = 'text';
          const textSlice = file.slice(0, 1024 * 1024);
          const fullText = await textSlice.text();
          if (requestId !== loadRequestId) return;
          nextTextContent = fullText;
          nextLineCount = fullText.split('\n').length;
          if (file.size > 1024 * 1024) {
            nextTextContent += '\n... (truncated)';
          }
        } else {
          nextMediaType = 'unknown';
        }

        let nextExifData: unknown | null = null;
        if (nextMediaType === 'image') {
          try {
            const exifrModule = await import('exifr');
            const data = await exifrModule.parse(file);
            if (requestId !== loadRequestId) return;
            nextExifData = data ?? null;
          } catch {
            if (requestId !== loadRequestId) return;
            nextExifData = null;
          }
        }

        const nextFileInfo: EntryPreviewInfo = {
          name: file.name,
          kind: 'file',
          path: entry.path,
          size: file.size,
          createdAt:
            entry.createdAt ||
            (typeof (entry as any)?.createdAt === 'number' ? (entry as any).createdAt : undefined),
          lastModified: entry.lastModified || file.lastModified,
          mimeType: getMimeTypeFromFilename(file.name),
          ext: fileExt,
          metadata:
            entry.path &&
            (nextMediaType === 'video' ||
              nextMediaType === 'audio' ||
              nextMediaType === 'image')
              ? params.getMetadata
                ? await params.getMetadata({
                    file,
                    entry,
                    path: entry.path,
                  })
                : await params.mediaStore.getOrFetchMetadataByPath(entry.path, {
                    forceRefresh: true,
                  })
              : undefined,
        };
        if (requestId !== loadRequestId) return;

        const previewState = await resolvePreviewMediaState(entry, nextMediaType, nextFileInfo);
        if (requestId !== loadRequestId) {
          if (previewState.currentUrl) {
            URL.revokeObjectURL(previewState.currentUrl);
          }
          return;
        }

        applyResolvedState({
          currentUrl: previewState.currentUrl,
          mediaType: nextMediaType,
          textContent: nextTextContent,
          fileInfo: nextFileInfo,
          exifData: nextExifData,
          imageDimensions: previewState.imageDimensions,
          lineCount: nextLineCount,
          timelineDocSummary: nextTimelineDocSummary,
        });
      } catch (e) {
        console.error('Failed to preview file:', e);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
    }
  });

  return {
    currentUrl,
    mediaType,
    textContent,
    fileInfo,
    exifData,
    exifYaml,
    imageDimensions,
    timelineDocSummary,
    lineCount,
    metadataYaml,
    isUnknown,
    isOtio,
    ext,
    loadPreviewMedia,
    thumbnailUrl: computed(
      () => getBdPayload(params.selectedFsEntry.value ?? {})?.thumbnailUrl ?? null,
    ),
  };
}
