import { computed, watch, type Ref } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { BROWSER_NATIVE_IMAGE_EXTENSIONS, getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';

export type FileCompatibilityStatus =
  | 'ok'
  | 'checking'
  | 'fully_unsupported'
  | 'audio_unsupported'
  | 'corrupt';

export interface FileCompatibility {
  status: FileCompatibilityStatus;
}

function computeStatus(
  entry: FsEntry,
  path: string,
  mediaType: 'video' | 'audio' | 'image',
  mediaMetadata: Record<string, unknown>,
  metadataLoadFailed: Record<string, boolean>,
  metadataLoading: Record<string, boolean>,
): FileCompatibilityStatus {
  const meta = mediaMetadata[path] as Record<string, unknown> | undefined;
  if ((meta as Record<string, unknown> | null)?.error || metadataLoadFailed[path]) return 'corrupt';
  if (!meta || metadataLoading[path]) return 'checking';

  if (mediaType === 'image') {
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    const canDisplay = (meta.image as Record<string, unknown> | undefined)?.canDisplay;
    if (canDisplay === false) {
      return BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext) ? 'corrupt' : 'fully_unsupported';
    }
    return 'ok';
  }

  if (mediaType === 'video') {
    const videoCanDecode = (meta.video as Record<string, unknown> | undefined)?.canDecode;
    const audioCanDecode = (meta.audio as Record<string, unknown> | undefined)?.canDecode;

    if (videoCanDecode === false) return 'fully_unsupported';
    if (audioCanDecode === false) return 'audio_unsupported';
    return 'ok';
  }

  if (mediaType === 'audio') {
    const audioCanDecode = (meta.audio as Record<string, unknown> | undefined)?.canDecode;
    if (audioCanDecode === false) return 'fully_unsupported';
    return 'ok';
  }

  return 'ok';
}

export function useFileManagerCompatibility(entries: Ref<FsEntry[]>) {
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
        if (
          !mediaStore.mediaMetadata[path] &&
          !mediaStore.metadataLoadFailed[path] &&
          !mediaStore.metadataLoading[path]
        ) {
          void mediaStore.getOrFetchMetadataByPath(path);
        }
      }
    },
    { immediate: true },
  );

  return { compatibility };
}
