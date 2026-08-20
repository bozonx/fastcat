import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import {
  fileExtension,
  isAudioUndecodable,
  isImageUndisplayable,
  isVideoUndecodable,
  type MediaCompatibilityMeta,
} from '~/utils/media/compatibility';

interface MediaSupportMediaStore {
  metadataLoadFailed: Record<string, boolean>;
}

export interface FileMediaSupportDeps {
  selectedFsEntry: () => FsEntry;
  mediaType: Ref<string | null>;
  mediaMeta: Ref<Record<string, unknown> | null | undefined>;
  fileInfo: Ref<{ kind?: string } | null | undefined>;
  isOtio: Ref<boolean>;
  isRemoteRoot: Ref<boolean>;
  metadataCacheKey: Ref<string | null>;
  mediaStore: MediaSupportMediaStore;
}

/**
 * Media type / codec support derivations rendered by `FileProperties.vue`
 * (preview visibility, "unsupported" banners, convertibility). Extracted as a
 * cohesive group of pure computeds.
 */
export function useFileMediaSupport(deps: FileMediaSupportDeps) {
  const isVideoFile = computed(() => deps.mediaType.value === 'video');
  const isAudioFile = computed(() => deps.mediaType.value === 'audio');
  const isVideoWithAudio = computed(() => Boolean(deps.mediaMeta.value?.audio));

  const isFormatUnsupported = computed(() =>
    Boolean(
      deps.metadataCacheKey.value &&
      deps.mediaStore.metadataLoadFailed[deps.metadataCacheKey.value],
    ),
  );

  const meta = computed(
    () => (deps.mediaMeta.value ?? undefined) as MediaCompatibilityMeta | undefined,
  );

  const isVideoCodecUnsupported = computed(() => isVideoUndecodable(meta.value));

  const isAudioCodecUnsupported = computed(() => isAudioUndecodable(meta.value));

  const isImageUnsupported = computed(() => {
    if (deps.mediaType.value !== 'image') return false;
    const ext = fileExtension(deps.selectedFsEntry()?.name ?? '');
    return isImageUndisplayable(meta.value, ext);
  });

  const isMediaFullyUnsupported = computed(
    () => isFormatUnsupported.value || isVideoCodecUnsupported.value || isImageUnsupported.value,
  );

  const videoCodecLabel = computed(() => {
    const v = deps.mediaMeta.value?.video as unknown as Record<string, unknown> | undefined;
    return String(v?.parsedCodec || v?.codec || '');
  });

  const audioCodecLabel = computed(() => {
    const a = deps.mediaMeta.value?.audio as unknown as Record<string, unknown> | undefined;
    return String(a?.parsedCodec || a?.codec || '');
  });

  const canConvertFile = computed(() => {
    if (isMediaFullyUnsupported.value) return false;
    const type = deps.mediaType.value;
    return type === 'video' || type === 'audio' || type === 'image';
  });

  const showPreviewSection = computed(() => {
    if (deps.fileInfo.value?.kind === 'directory' || deps.isRemoteRoot.value) return false;
    const type = deps.mediaType.value;
    return (
      type === 'image' ||
      type === 'video' ||
      type === 'audio' ||
      (type === 'text' && !deps.isOtio.value)
    );
  });

  return {
    isVideoFile,
    isAudioFile,
    isVideoWithAudio,
    isFormatUnsupported,
    isVideoCodecUnsupported,
    isAudioCodecUnsupported,
    isImageUnsupported,
    isMediaFullyUnsupported,
    videoCodecLabel,
    audioCodecLabel,
    canConvertFile,
    showPreviewSection,
  };
}
