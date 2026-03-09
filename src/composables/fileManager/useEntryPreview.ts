import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import yaml from 'js-yaml';
import { TEXT_EXTENSIONS, getMediaTypeFromFilename } from '~/utils/media-types';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
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
    typeof doc.metadata?.gran?.version === 'number' ? doc.metadata.gran.version : null;
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
  onResetPreviewMode: (mode: PreviewMode) => void;
}) {
  const currentUrl = ref<string | null>(null);
  const mediaType = ref<MediaType>(null);
  const textContent = ref<string>('');
  const fileInfo = ref<EntryPreviewInfo | null>(null);
  const exifData = ref<unknown | null>(null);
  const imageDimensions = ref<{ width: number; height: number } | null>(null);
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
      params.onResetPreviewMode('original');

      if (!entry) return;

      if (entry.kind === 'directory') {
        const size = entry.path ? undefined : 0;
        fileInfo.value = {
          name: entry.name,
          kind: 'directory',
          path: entry.path,
          size,
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

        if (fileExt === 'otio') {
          mediaType.value = 'text';
          try {
            const text = await file.text();
            const parsedDoc = parseTimelineFromOtio(text, {
              id: entry.path ?? 'unknown',
              name: entry.name,
              fps: 25,
            });
            timelineDocSummary.value = computeTimelineSummary(parsedDoc);
          } catch {
            timelineDocSummary.value = null;
          }
        } else if (file.type.startsWith('image/')) {
          mediaType.value = 'image';
        } else if (file.type.startsWith('video/')) {
          mediaType.value = 'video';
        } else if (file.type.startsWith('audio/')) {
          mediaType.value = 'audio';
        } else if (textExtensions.includes(fileExt || '') || file.type.startsWith('text/')) {
          mediaType.value = 'text';
          const textSlice = file.slice(0, 1024 * 1024);
          textContent.value = await textSlice.text();
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
          mimeType: typeof file.type === 'string' ? file.type : undefined,
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
    metadataYaml,
    isUnknown,
    isOtio,
    ext,
    loadPreviewMedia,
  };
}
