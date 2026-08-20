import { computed, watch, type Ref } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import {
  computeMediaCompatibilityStatus,
  fileExtension,
  type FileCompatibilityStatus,
} from '~/utils/media/compatibility';
import type { FsEntry } from '~/types/fs';

export type { FileCompatibilityStatus } from '~/utils/media/compatibility';

export interface FileCompatibility {
  status: FileCompatibilityStatus;
}

function resolveMetadataCacheKey(entry: FsEntry, path: string): string {
  if (entry.source === 'remote') return `external:${path}`;
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return `external:${path}`;
  return path;
}

function computeStatus(
  entry: FsEntry,
  path: string,
  mediaType: 'video' | 'audio' | 'image',
  mediaMetadata: Record<string, unknown>,
  metadataLoadFailed: Record<string, boolean>,
  metadataLoading: Record<string, boolean>,
): FileCompatibilityStatus {
  const cacheKey = path;
  const externalKey = `external:${path}`;

  const meta = (mediaMetadata[cacheKey] ?? mediaMetadata[externalKey]) as
    Record<string, unknown> | undefined;
  const isFailed = Boolean(metadataLoadFailed[cacheKey] || metadataLoadFailed[externalKey]);
  const isLoading = Boolean(metadataLoading[cacheKey] || metadataLoading[externalKey]);

  const isRemote = entry.source === 'remote';
  const isExternal = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

  return computeMediaCompatibilityStatus({
    meta,
    mediaType,
    ext: fileExtension(entry.name),
    isFailed,
    isLoading,
    treatUnknownAsOk: isRemote || isExternal,
  });
}

export function useFileManagerCompatibility(
  entries: Ref<FsEntry[]>,
  options?: {
    getFileByPath?: (path: string) => Promise<File | null>;
  },
) {
  const mediaStore = useMediaStore();

  const compatibility = computed<Record<string, FileCompatibility>>(() => {
    const result: Record<string, FileCompatibility> = {};

    for (const entry of entries.value) {
      if (entry.kind !== 'file' || !entry.path) continue;

      const mediaType = getMediaTypeFromFilename(entry.name);
      if (mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'image') continue;

      const status = computeStatus(
        entry,
        entry.path,
        mediaType,
        mediaStore.mediaMetadata,
        mediaStore.metadataLoadFailed,
        mediaStore.metadataLoading,
      );

      result[entry.path] = { status };
    }

    return result;
  });

  // Trigger metadata loading for visible media files that aren't cached yet
  watch(
    entries,
    (currentEntries) => {
      for (const entry of currentEntries) {
        if (entry.kind !== 'file' || !entry.path) continue;

        const mediaType = getMediaTypeFromFilename(entry.name);
        if (mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'image') continue;

        const path = entry.path;
        const cacheKey = resolveMetadataCacheKey(entry, path);
        if (
          !mediaStore.mediaMetadata[cacheKey] &&
          !mediaStore.metadataLoadFailed[cacheKey] &&
          !mediaStore.metadataLoading[cacheKey]
        ) {
          if (cacheKey === path) {
            void mediaStore.getOrFetchMetadataByPath(path);
          } else if (options?.getFileByPath) {
            void options
              .getFileByPath(path)
              .then(async (file) => {
                if (!file) return null;
                return await mediaStore.getOrFetchMetadata(file, cacheKey);
              })
              .catch(() => null);
          }
        }
      }
    },
    { immediate: true },
  );

  return { compatibility };
}
