import { toRef } from 'vue';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileConversionActions } from '~/composables/file-conversion/useFileConversionActions';

export function useFileConversionStoreActions(
  store: ReturnType<typeof useFileConversionStore>,
  fileManager: ReturnType<typeof useFileManager>,
) {
  return useFileConversionActions({
    targetEntry: toRef(store, 'targetEntry'),
    targetIsExternal: toRef(store, 'targetIsExternal'),
    targetVfs: toRef(store, 'targetVfs'),
    targetReloadDirectory: toRef(store, 'targetReloadDirectory'),
    mediaType: toRef(store, 'mediaType'),
    videoSettings: store.video,
    audioSettings: store.audio,
    imageSettings: store.image,
    isCancelRequested: toRef(store, 'isCancelRequested'),
    isConverting: toRef(store, 'isConverting'),
    isExtractingMetadata: toRef(store, 'isExtractingMetadata'),
    conversionError: toRef(store, 'conversionError'),
    conversionWarnings: toRef(store, 'conversionWarnings'),
    isModalOpen: toRef(store, 'isModalOpen'),
    conversionModalRequestId: toRef(store, 'conversionModalRequestId'),
    sourceHasAudio: toRef(store, 'sourceHasAudio'),
    fileManager,
  });
}
