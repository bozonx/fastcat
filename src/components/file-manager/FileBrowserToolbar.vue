<script setup lang="ts">
import { computed, inject } from 'vue';
import { useFileManagerStore, useFileBrowserPersistenceStore, type FileSortField } from '~/stores/file-manager.store';
import { useUiStore } from '~/stores/ui.store';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiToggleButton from '~/components/ui/UiToggleButton.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';

const props = defineProps<{
  gridSizes: number[];
  currentGridSizeName: string;
  gridCardSize: number;
  remoteAvailable?: boolean;
  isRemotePanel?: boolean;
  compact?: boolean;
  hideActions?: boolean;
  hideUpload?: boolean;
}>();


const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'openRemote'): void;
  (e: 'closeRemote'): void;
  (e: 'createFolder'): void;
  (e: 'upload'): void;
}>();

const { t } = useI18n();
const fileManagerStore = (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) || useFileManagerStore();
const persistenceStore = useFileBrowserPersistenceStore();
const uiStore = useUiStore();



const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name', 'Name'), value: 'name' },
  { label: t('common.type', 'Type'), value: 'type' },
  { label: t('common.size', 'Size'), value: 'size' },
  { label: t('common.created', 'Created'), value: 'created' },
  { label: t('common.modified', 'Modified'), value: 'modified' },
];

const toolbarMenuItems = computed(() => {
  const items = [];

  // 1. Actions group
  const actions = [
    {
      label: t('common.refresh', 'Refresh'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => emit('refresh'),
    },
  ];

  if (!props.isRemotePanel) {
    actions.push({
      label: uiStore.showHiddenFiles
        ? t('videoEditor.fileManager.actions.hideHiddenFiles', 'Hide hidden files')
        : t('videoEditor.fileManager.actions.showHiddenFiles', 'Show hidden files'),
      icon: uiStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onSelect: () => {
        uiStore.showHiddenFiles = !uiStore.showHiddenFiles;
      },
    });
  }

  items.push(actions);

  // 2. Sort Fields Section
  const allowedFields = props.isRemotePanel
    ? ['name', 'created']
    : ['name', 'type', 'size', 'created', 'modified'];

  const filteredSortFields = sortFields.filter((f) => allowedFields.includes(f.value));

  const sortSection = filteredSortFields.map((field) => ({
    label: field.label,
    icon: fileManagerStore.sortOption.field === field.value ? 'i-heroicons-check' : undefined,
    onSelect: () => {
      fileManagerStore.sortOption.field = field.value;
      emit('refresh');
    },
  }));

  if (sortSection.length > 0) {
    items.push(sortSection);

    // 3. Sort Order Section
    items.push([
      {
        label: t('common.sortOrder.asc', 'Ascending'),
        icon: fileManagerStore.sortOption.order === 'asc' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          fileManagerStore.sortOption.order = 'asc';
          emit('refresh');
        },
      },
      {
        label: t('common.sortOrder.desc', 'Descending'),
        icon: fileManagerStore.sortOption.order === 'desc' ? 'i-heroicons-check' : undefined,
        onSelect: () => {
          fileManagerStore.sortOption.order = 'desc';
          emit('refresh');
        },
      },
    ]);
  }

  return items;
});
</script>

<template>
  <div
    class="flex items-center gap-4 px-4 py-2 border-b border-ui-border shrink-0 bg-ui-bg-elevated/50"
  >


    <div v-if="!isRemotePanel" class="flex items-center gap-1">
      <UiToggleButton
        :model-value="fileManagerStore.viewMode === 'grid'"
        icon="i-heroicons-squares-2x2"
        inactive-color="neutral"
        active-color="primary"
        size="sm"
        title="Grid view"
        no-toggle
        @click="fileManagerStore.setViewMode('grid')"
      />
      <UiToggleButton
        :model-value="fileManagerStore.viewMode === 'list'"
        icon="i-heroicons-list-bullet"
        inactive-color="neutral"
        active-color="primary"
        size="sm"
        title="List view"
        no-toggle
        @click="fileManagerStore.setViewMode('list')"
      />

      <div class="w-px h-4 bg-ui-border mx-2"></div>

      <UiActionButton
        v-if="!hideActions"
        icon="i-heroicons-folder-plus"
        variant="ghost"
        color="neutral"
        size="sm"
        :title="t('videoEditor.fileManager.actions.createFolder', 'Create Folder')"
        @click="emit('createFolder')"
      />
      <UiActionButton
        v-if="!hideActions && !hideUpload"
        icon="i-heroicons-arrow-up-tray"
        variant="ghost"
        color="neutral"
        size="sm"
        :title="t('videoEditor.fileManager.actions.uploadFiles', 'Upload files')"
        @click="emit('upload')"
      />

    </div>

    <div
      v-if="props.isRemotePanel || fileManagerStore.viewMode === 'grid'"
      class="flex items-center gap-2 ml-2 w-24"
      :title="`${t('videoEditor.fileManager.cardScale', 'Card scale')}: ${currentGridSizeName}`"
    >
      <UiWheelSlider
        :model-value="gridSizes.indexOf(props.gridCardSize)"
        :min="0"
        :max="gridSizes.length - 1"
        :step="1"
        wheel-without-focus
        class="flex-1 w-full"
        @update:model-value="
          (v: number) => {
            const size = gridSizes[v] || 80;
            if (props.isRemotePanel) {
              persistenceStore.setBloggerDogGridCardSize(size);
            } else {
              fileManagerStore.setGridCardSize(size);
            }
          }
        "
      />
    </div>

    <div class="ml-auto flex items-center gap-2">
      <template v-if="!compact">
        <div v-if="toolbarMenuItems.length > 0" class="w-px h-4 bg-ui-border mx-1"></div>
        


        <UDropdownMenu v-if="toolbarMenuItems.length > 0" :items="toolbarMenuItems" :ui="{ content: 'w-56' }">
          <UiActionButton
            icon="i-heroicons-ellipsis-horizontal"
            variant="ghost"
            color="neutral"
            size="xs"
          />
        </UDropdownMenu>
      </template>
    </div>
  </div>
</template>
