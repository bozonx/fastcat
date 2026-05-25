import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import {
  canCopyBloggerDogEntry,
  canCutBloggerDogEntry,
  canPasteIntoBloggerDogEntry,
} from '~/utils/bloggerdog-file-manager';

export interface FilePropertiesClipboardDeps {
  selectedFsEntry: () => FsEntry;
  isRootDirectory: Ref<boolean>;
  isCommonRoot: Ref<boolean>;
}

/**
 * Copy / cut / paste handling for the selected file-manager entry, extracted
 * from `FileProperties.vue`.
 */
export function useFilePropertiesClipboard(deps: FilePropertiesClipboardDeps) {
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const clipboardStore = useAppClipboard();

  const canCopy = computed(() => {
    if (deps.isRootDirectory.value || deps.isCommonRoot.value) return false;
    return canCopyBloggerDogEntry(deps.selectedFsEntry());
  });

  const canCut = computed(() => {
    if (deps.isRootDirectory.value || deps.isCommonRoot.value) return false;
    return canCutBloggerDogEntry(deps.selectedFsEntry());
  });

  function resolveSourceInstanceId(): string | undefined {
    return selectionStore.selectedEntity?.source === 'fileManager'
      ? selectionStore.selectedEntity.instanceId
      : undefined;
  }

  function onCopy() {
    const entry = deps.selectedFsEntry();
    if (!entry || !entry.path) return;
    clipboardStore.setClipboardPayload({
      source: 'fileManager',
      operation: 'copy',
      items: [{ path: entry.path, kind: entry.kind, name: entry.name, source: entry.source }],
      sourceInstanceId: resolveSourceInstanceId(),
    });
  }

  function onCut() {
    const entry = deps.selectedFsEntry();
    if (!entry || !entry.path) return;
    clipboardStore.setClipboardPayload({
      source: 'fileManager',
      operation: 'cut',
      items: [{ path: entry.path, kind: entry.kind, name: entry.name, source: entry.source }],
      sourceInstanceId: resolveSourceInstanceId(),
    });
  }

  function onPaste() {
    const entry = deps.selectedFsEntry();
    if (!entry || entry.kind !== 'directory') return;
    if (entry.source === 'remote' && !canPasteIntoBloggerDogEntry(entry)) return;
    uiStore.pendingFsEntryPaste = entry;
  }

  const hasClipboardItems = computed(() => clipboardStore.hasFileManagerPayload);

  return {
    canCopy,
    canCut,
    onCopy,
    onCut,
    onPaste,
    hasClipboardItems,
  };
}
