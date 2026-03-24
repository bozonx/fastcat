import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import yaml from 'js-yaml';
import {
  TEXT_EXTENSIONS,
  getMediaTypeFromFilename,
  getMimeTypeFromFilename,
} from '~/utils/media-types';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { computeDirectoryStats } from '~/utils/fs';
import type { TimelineDocument } from '~/timeline/types';
import type { FsEntry } from '~/types/fs';
import type { MediaMetadata } from '~/stores/media.store';

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

  async function loadPreviewMedia() {
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
      currentUrl.value = null;
    }

    const entry = params.selectedFsEntry.value;
    if (!entry || entry.kind !== 'file') return;

    try {
      let fileToPlay: File;

      if (params.previewMode.value === 'proxy' && params.hasProxy.value && entry.path) {
        const proxyFile = await params.proxyStore.getProxyFile(entry.path);
        if (proxyFile) {
          fileToPlay = proxyFile;
        } else {
          const file = await params.getFileByPath(entry.path);
          if (!file) return;
          fileToPlay = file;
        }
      } else {
        const file = await params.getFileByPath(entry.path);
        if (!file) return;
        fileToPlay = file;
      }

      if (
        mediaType.value === 'image' ||
        mediaType.value === 'video' ||
        mediaType.value === 'audio'
      ) {
        currentUrl.value = URL.createObjectURL(fileToPlay);
      }

      if (mediaType.value === 'image') {
        try {
          const bitmap = await createImageBitmap(fileToPlay);
          if (params.selectedFsEntry.value === entry) {
            imageDimensions.value = { width: bitmap.width, height: bitmap.height };
          }
          bitmap.close();
        } catch {
          if (params.selectedFsEntry.value === entry) {
            imageDimensions.value = null;
          }
        }
      }
    } catch (e) {
      console.error('Failed to load preview media:', e);
    }
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
      if (currentUrl.value) {
        URL.revokeObjectURL(currentUrl.value);
        currentUrl.value = null;
      }
      mediaType.value = null;
      textContent.value = '';
      fileInfo.value = null;
      exifData.value = null;
      imageDimensions.value = null;
      timelineDocSummary.value = null;
      lineCount.value = null;
      params.onResetPreviewMode('original');

      if (!entry) return;

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

        fileInfo.value = {
          name: entry.name,
          kind: 'directory',
          path: entry.path,
          size,
          filesCount,
        };
        return;
      }

      try {
        const fileExt = entry.name.split('.').pop()?.toLowerCase() || '';
        const extBasedType = getMediaTypeFromFilename(entry.name);
        if (extBasedType !== 'unknown') {
          mediaType.value = extBasedType === 'timeline' ? 'text' : extBasedType;
        }

        const file = await params.getFileByPath(entry.path);
        if (!file) return;

        const textExtensions = TEXT_EXTENSIONS;

        if (fileExt === 'otio' || extBasedType === 'timeline') {
          mediaType.value = 'text';
          try {
            const text = await file.text();
            lineCount.value = text.split('\n').length;
            const parsedDoc = parseTimelineFromOtio(text, {
              id: entry.path ?? 'unknown',
              name: entry.name,
              fps: 25,
            });
            timelineDocSummary.value = computeTimelineSummary(parsedDoc);
          } catch {
            timelineDocSummary.value = null;
          }
        } else if (extBasedType === 'image') {
          mediaType.value = 'image';
        } else if (extBasedType === 'video') {
          mediaType.value = 'video';
        } else if (extBasedType === 'audio') {
          mediaType.value = 'audio';
        } else if (extBasedType === 'text') {
          mediaType.value = 'text';
          const textSlice = file.slice(0, 1024 * 1024);
          const fullText = await textSlice.text();
          textContent.value = fullText;
          lineCount.value = fullText.split('\n').length;
          if (file.size > 1024 * 1024) {
            textContent.value += '\n... (truncated)';
          }
        } else {
          mediaType.value = 'unknown';
        }

        const selectionKey = entry;
        if (mediaType.value === 'image') {
          try {
            const exifrModule = await import('exifr');
            const data = await exifrModule.parse(file);

            if (params.selectedFsEntry.value !== selectionKey) return;
            exifData.value = data ?? null;
          } catch {
            if (params.selectedFsEntry.value !== selectionKey) return;
            exifData.value = null;
          }
        }

        fileInfo.value = {
          name: file.name,
          kind: 'file',
          path: entry.path,
          size: file.size,
          createdAt:
            typeof (entry as any)?.createdAt === 'number' ? (entry as any).createdAt : undefined,
          lastModified: file.lastModified,
          mimeType: getMimeTypeFromFilename(file.name),
          ext: fileExt,
          metadata:
            entry.path && (mediaType.value === 'video' || mediaType.value === 'audio')
              ? await params.mediaStore.getOrFetchMetadataByPath(entry.path, {
                  forceRefresh: true,
                })
              : undefined,
        };

        if (
          mediaType.value === 'image' ||
          mediaType.value === 'video' ||
          mediaType.value === 'audio'
        ) {
          await loadPreviewMedia();
        }
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
  };
}
