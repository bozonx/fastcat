import { computed, watch, type Ref } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';

export type FileCompatibilityStatus = 'ok' | 'fully_unsupported' | 'audio_unsupported' | 'corrupt';

export interface FileCompatibility {
  status: FileCompatibilityStatus;
}

function computeStatus(
  path: string,
  mediaType: 'video' | 'audio' | 'image',
  mediaMetadata: Record<string, any>,
  metadataLoadFailed: Record<string, boolean>,
): FileCompatibilityStatus {
  const meta = mediaMetadata[path];
  if (meta?.error || metadataLoadFailed[path]) return 'corrupt';
  if (!meta) return 'ok';

  if (mediaType === 'image') {
    if (meta.image?.canDisplay === false) return 'corrupt';
    return 'ok';
  }

  if (mediaType === 'video') {
    const videoCanDecode = meta.video?.canDecode;
    const audioCanDecode = meta.audio?.canDecode;

    if (videoCanDecode === false) return 'fully_unsupported';
    if (audioCanDecode === false) return 'audio_unsupported';
    return 'ok';
  }

  if (mediaType === 'audio') {
    const audioCanDecode = meta.audio?.canDecode;
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
        entry.path,
        mediaType,
        mediaStore.mediaMetadata,
        mediaStore.metadataLoadFailed,
      );

      if (status !== 'ok') {
        result[entry.path] = { status };
      }
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
        if (!mediaStore.mediaMetadata[path] && !mediaStore.metadataLoadFailed[path]) {
          void mediaStore.getOrFetchMetadataByPath(path);
        }
      }
    },
    { immediate: true },
  );

  return { compatibility };
}
