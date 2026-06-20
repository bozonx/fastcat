import { storeToRefs } from 'pinia';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useFileConversionActions } from '~/composables/file-conversion/useFileConversionActions';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export function useFileConversionStoreActions(
  store: ReturnType<typeof useFileConversionStore>,
  fileManager: {
    vfs: IFileSystemAdapter;
    reloadDirectory: (path: string) => Promise<void>;
  },
) {
  const {
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    isCancelRequested,
    isConverting,
    isExtractingMetadata,
    conversionError,
    conversionWarnings,
    isModalOpen,
    conversionModalRequestId,
    sourceHasAudio,
  } = storeToRefs(store);

  return useFileConversionActions({
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    videoSettings: store.video,
    audioSettings: store.audio,
    imageSettings: store.image,
    isCancelRequested,
    isConverting,
    isExtractingMetadata,
    conversionError,
    conversionWarnings,
    isModalOpen,
    conversionModalRequestId,
    sourceHasAudio,
    fileManager,
  });
}
