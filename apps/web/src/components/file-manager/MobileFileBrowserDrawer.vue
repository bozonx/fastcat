<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import {
  getMediaTypeFromFilename,
  isMobileTimelineAddableProjectFileName,
} from '~/utils/media-types';
import type { FileAction as FileManagerAction } from '~/composables/file-manager/useFileManagerActions';
import type { SelectedFsEntry, SelectedFsEntries } from '~/stores/selection.store';
import type { FsEntry } from '~/types/fs';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';
import { useProxyStore } from '~/stores/proxy.store';
import { useMediaStore } from '~/stores/media.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { getBdPayload } from '~/types/bloggerdog';
import {
  canCopyBloggerDogEntry,
  canCutBloggerDogEntry,
  canPasteIntoBloggerDogEntry,
  isBloggerDogTextWrapper,
} from '~/utils/bloggerdog-file-manager';
import { WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useFileConversionStoreActions } from '~/composables/file-conversion/useFileConversionStoreActions';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { normalizeMediaCachePath } from '~/utils/path';

type DrawerAction = FileManagerAction | 'openAsPanelCut' | 'openAsPanelSound' | 'openAsProjectTab';

const props = defineProps<{
  isOpen: boolean;
  isSelectionMode: boolean;
  hideClipboardActions?: boolean;
  onAction?: (action: DrawerAction, entry: FsEntry | FsEntry[]) => Promise<void>;
}>();

const { isOpen, isSelectionMode, onAction } = toRefs(props);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-to-timeline'): void;
}>();

const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const mediaStore = useMediaStore();
const clipboardStore = useAppClipboard();

const fileManager = useFileManager();
const { vfs: computerVfs } = useComputerVfs();
const conversionStore = useFileConversionStore();
const { openConversionModal } = useFileConversionStoreActions(conversionStore, fileManager);

const isExternal = computed(() => {
  const entity = selectedFsEntry.value;
  if (!entity) return false;
  return (
    entity.origin === 'workspace-browser' ||
    entity.origin === 'remote-browser' ||
    entity.isExternal ||
    entity.instanceId === 'computer' ||
    entity.instanceId === 'sidebar' ||
    entity.entry?.source === 'remote'
  );
});

const selectedEntity = computed(() => selectionStore.selectedEntity);

const isOpenLocal = computed({
  get: () => isOpen.value,
  set: (val) => {
    if (!val) {
      emit('close');
    }
  },
});

const selectedFsEntry = computed(() => {
  if (
    selectedEntity.value?.source === 'fileManager' &&
    (selectedEntity.value.kind === 'file' || selectedEntity.value.kind === 'directory')
  ) {
    return selectedEntity.value as SelectedFsEntry;
  }
  return null;
});

const isTextDocument = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return type === 'text' || type === 'timeline';
});

const selectedFsMultiple = computed(() => {
  if (selectedEntity.value?.source === 'fileManager' && selectedEntity.value.kind === 'multiple') {
    return selectedEntity.value as SelectedFsEntries;
  }
  return null;
});

const selectedEntriesList = computed(() => {
  if (!selectedEntity.value || selectedEntity.value.source !== 'fileManager') return [];
  if (selectedEntity.value.kind === 'multiple') return selectedEntity.value.entries;
  return [selectedEntity.value.entry];
});

const canRename = computed(() => {
  if (selectedEntriesList.value.length !== 1) return false;
  return (
    !isProjectRoot.value &&
    !isCommonRoot.value &&
    !isBdVirtual.value &&
    !isBdProject.value &&
    !isBdText.value
  );
});

const canDelete = computed(() => {
  if (selectedEntriesList.value.length === 0) return false;
  if (selectedEntriesList.value.length > 1) return true;
  return (
    !isProjectRoot.value &&
    !isCommonRoot.value &&
    !isBdVirtual.value &&
    !isBdProject.value &&
    !isBdText.value
  );
});

const isBdVirtual = computed(() =>
  selectedFsEntry.value
    ? getBdPayload(selectedFsEntry.value.entry)?.type === 'virtual-folder'
    : false,
);
const isBdProject = computed(() =>
  selectedFsEntry.value ? getBdPayload(selectedFsEntry.value.entry)?.type === 'project' : false,
);
const isBdText = computed(() =>
  selectedFsEntry.value ? isBloggerDogTextWrapper(selectedFsEntry.value.entry) : false,
);
const isBdGroup = computed(() =>
  selectedFsEntry.value ? getBdPayload(selectedFsEntry.value.entry)?.type === 'collection' : false,
);
const isBdContentItem = computed(() =>
  selectedFsEntry.value
    ? getBdPayload(selectedFsEntry.value.entry)?.type === 'content-item'
    : false,
);
const isProjectRoot = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  return entry?.kind === 'directory' && (entry.path === '' || entry.path === '/');
});
const isCommonRoot = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'directory') return false;
  return (
    entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
    (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === ''))
  );
});

const isFullyUnsupported = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'file' || !entry.path) return false;
  if (mediaStore.metadataLoadFailed[entry.path]) return true;
  const meta = mediaStore.getCachedMetadata(entry.path);
  if (!meta) return false;
  if (meta.error) return true;
  const type = getMediaTypeFromFilename(entry.name);
  if (type === 'image' && meta.image?.canDisplay === false) return true;
  if (type === 'video' && meta.video?.canDecode === false) return true;
  if (type === 'audio' && meta.audio?.canDecode === false) return true;
  return false;
});

const canAddToTimeline = computed(() => {
  if (isSelectionMode.value) return false;
  if (!selectedEntity.value || selectedEntity.value.kind !== 'file') return false;
  if (selectedEntity.value.entry.source === 'remote') return false;
  if (isFullyUnsupported.value) return false;
  return isMobileTimelineAddableProjectFileName(selectedEntity.value.name);
});

const hasExistingProxy = computed(() => {
  if (!selectedFsEntry.value || !selectedFsEntry.value.path) return false;
  return proxyStore.existingProxies.has(normalizeMediaCachePath(selectedFsEntry.value.path));
});

function canTransferSelection(
  entries: FsEntry[],
  checkEntry: (entry: FsEntry) => boolean,
): boolean {
  if (entries.length === 0) return false;
  return entries.every((entry) => {
    const payload = getBdPayload(entry);
    return (
      !(entry.kind === 'directory' && (entry.path === '' || entry.path === '/')) &&
      !(
        entry.kind === 'directory' &&
        (entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
          (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === '')))
      ) &&
      payload?.type !== 'virtual-folder' &&
      payload?.type !== 'project' &&
      payload?.type !== 'collection' &&
      payload?.type !== 'content-item' &&
      checkEntry(entry)
    );
  });
}

const canCopySelection = computed(() =>
  canTransferSelection(selectedEntriesList.value, canCopyBloggerDogEntry),
);

const canCutSelection = computed(() =>
  canTransferSelection(selectedEntriesList.value, canCutBloggerDogEntry),
);

const canPasteIntoSelection = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || !clipboardStore.hasFileManagerPayload) return false;
  if (entry.source === 'remote') return canPasteIntoBloggerDogEntry(entry);

  return (
    (entry.kind === 'directory' && !isBdGroup.value && !isBdVirtual.value && !isBdProject.value) ||
    isBdContentItem.value
  );
});

function handleAction(actionId: DrawerAction) {
  if (onAction?.value) {
    const list = selectedEntriesList.value;
    if (list.length === 1 && list[0]) {
      void onAction.value(actionId, list[0]);
    } else if (list.length > 0) {
      void onAction.value(actionId, list);
    }
  }
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false" :ui="{ container: 'h-[85dvh]' }">
    <div class="flex flex-col h-full relative overflow-hidden">
      <!-- Scrollable content -->
      <div
        class="flex-1 min-h-0 px-4"
        :class="isTextDocument ? 'flex flex-col overflow-hidden pb-4' : 'overflow-y-auto pb-24'"
        data-vaul-no-drag
      >
        <div class="mb-4 pt-1">
          <MobileDrawerToolbar
            v-if="selectedEntriesList.length > 0"
            class="-mx-4 border-b border-ui-border mb-2"
          >
            <MobileDrawerToolbarButton
              v-if="canDelete"
              icon="i-heroicons-trash"
              @click="handleAction('delete')"
            />
            <MobileDrawerToolbarButton
              v-if="canRename"
              icon="i-heroicons-pencil-square"
              :label="$t('common.rename')"
              @click="handleAction('rename')"
            />
            <MobileDrawerToolbarButton
              v-if="!hideClipboardActions && canCopySelection"
              icon="i-heroicons-document-duplicate"
              @click="handleAction('copy')"
            />
            <MobileDrawerToolbarButton
              v-if="!hideClipboardActions && canCutSelection"
              icon="i-heroicons-scissors"
              @click="handleAction('cut')"
            />
            <MobileDrawerToolbarButton
              v-if="!hideClipboardActions && canPasteIntoSelection"
              icon="i-heroicons-clipboard"
              @click="handleAction('paste')"
            />
            <MobileDrawerToolbarButton
              v-if="canAddToTimeline"
              success
              icon="lucide:plus"
              :label="$t('common.toTimeline')"
              @click="emit('add-to-timeline')"
            />
          </MobileDrawerToolbar>
        </div>

        <div
          v-if="selectedFsEntry"
          :class="isTextDocument ? 'flex-1 flex flex-col min-h-0 py-2' : 'h-full py-2'"
        >
          <FileProperties
            :selected-fs-entry="selectedFsEntry.entry"
            preview-mode="original"
            :has-proxy="hasExistingProxy"
            :mobile-text-mode="isTextDocument"
            :is-external="selectedFsEntry.isExternal"
            :selection-origin="selectedFsEntry.origin"
            :instance-id="selectedFsEntry.instanceId"
            @close-drawer="emit('close')"
            @convert="
              (entry) =>
                openConversionModal(entry, {
                  isExternal: isExternal,
                  vfs: isExternal ? (computerVfs ?? null) : fileManager.vfs,
                  reloadDirectory: fileManager.reloadDirectory,
                })
            "
          />
        </div>
        <div v-else-if="selectedFsMultiple" class="py-2">
          <MultiFileProperties :entries="selectedFsMultiple.entries" />
        </div>
      </div>
    </div>
  </UiMobileDrawer>
</template>

<style scoped>
/* No extra styles needed as they're now in UiMobileDrawer */
</style>
