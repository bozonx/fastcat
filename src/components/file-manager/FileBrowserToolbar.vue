<script setup lang="ts">
import { computed } from 'vue';
import { useFileManagerStore, type FileSortField } from '~/stores/file-manager.store';
import { useUiStore } from '~/stores/ui.store';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiToggleButton from '~/components/ui/UiToggleButton.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';

const props = defineProps<{
  gridSizes: number[];
  currentGridSizeName: string;
  remoteAvailable?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'openRemote'): void;
  (e: 'createFolder'): void;
  (e: 'upload'): void;
}>();

const { t } = useI18n();
const fileManagerStore = useFileManagerStore();
const uiStore = useUiStore();

const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name', 'Name'), value: 'name' },
  { label: t('common.type', 'Type'), value: 'type' },
  { label: t('common.size', 'Size'), value: 'size' },
  { label: t('common.created', 'Created'), value: 'created' },
  { label: t('common.modified', 'Modified'), value: 'modified' },
];
</script>

<template>
  <div
    class="flex items-center gap-4 px-4 py-2 border-b border-ui-border shrink-0 bg-ui-bg-elevated/50"
  >
    <div class="flex items-center gap-1">
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
        icon="i-heroicons-folder-plus"
        variant="ghost"
        color="neutral"
        size="sm"
        :title="t('videoEditor.fileManager.actions.createFolder', 'Create Folder')"
        @click="emit('createFolder')"
      />
      <UiActionButton
        icon="i-heroicons-arrow-up-tray"
        variant="ghost"
        color="neutral"
        size="sm"
        :title="t('videoEditor.fileManager.actions.uploadFiles', 'Upload files')"
        @click="emit('upload')"
      />
    </div>

    <!-- Card size slider (only in grid view) -->
    <div
      v-if="fileManagerStore.viewMode === 'grid'"
      class="flex items-center gap-2 ml-2 w-24"
      :title="`${t('videoEditor.fileManager.cardScale', 'Card scale')}: ${currentGridSizeName}`"
    >
      <UiWheelSlider
        :model-value="gridSizes.indexOf(fileManagerStore.gridCardSize)"
        :min="0"
        :max="gridSizes.length - 1"
        :step="1"
        wheel-without-focus
        class="flex-1 w-full"
        @update:model-value="(v: number) => fileManagerStore.setGridCardSize(gridSizes[v] || 130)"
      />
    </div>

    <div class="ml-auto flex items-center gap-2">
      <template v-if="!compact">
        <UiActionButton
          v-if="remoteAvailable"
          color="neutral"
          size="xs"
          icon="i-heroicons-cloud"
          label="Remote"
          @click="emit('openRemote')"
        />
        <span class="text-xs text-ui-text-muted">{{ t('common.sortBy', 'Sort by') }}:</span>
        <UiSelect
          v-model="fileManagerStore.sortOption.field"
          :items="sortFields"
          value-key="value"
          size="xs"
          class="w-32"
        />
        <UiToggleButton
          :model-value="fileManagerStore.sortOption.order === 'asc'"
          icon="i-heroicons-bars-arrow-down"
          active-icon="i-heroicons-bars-arrow-up"
          inactive-color="neutral"
          active-color="primary"
          size="xs"
          title="Sort order"
          no-toggle
          @click="
            fileManagerStore.sortOption.order =
              fileManagerStore.sortOption.order === 'asc' ? 'desc' : 'asc'
          "
        />
        <div class="w-px h-4 bg-ui-border mx-1"></div>
      </template>
    </div>
  </div>
</template>
