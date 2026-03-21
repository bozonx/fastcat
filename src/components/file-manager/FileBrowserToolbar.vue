<script setup lang="ts">
import { useFilesPageStore, type FileSortField } from '~/stores/files-page.store';
import { useUiStore } from '~/stores/ui.store';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

defineProps<{
  gridSizes: number[];
  currentGridSizeName: string;
  remoteAvailable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'openRemote'): void;
}>();

const { t } = useI18n();
const filesPageStore = useFilesPageStore();
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
        :model-value="filesPageStore.viewMode === 'grid'"
        icon="i-heroicons-squares-2x2"
        inactive-color="neutral"
        active-color="primary"
        size="sm"
        title="Grid view"
        no-toggle
        @click="filesPageStore.setViewMode('grid')"
      />
      <UiToggleButton
        :model-value="filesPageStore.viewMode === 'list'"
        icon="i-heroicons-list-bullet"
        inactive-color="neutral"
        active-color="primary"
        size="sm"
        title="List view"
        no-toggle
        @click="filesPageStore.setViewMode('list')"
      />
    </div>

    <!-- Card size slider (only in grid view) -->
    <div
      v-if="filesPageStore.viewMode === 'grid'"
      class="flex items-center gap-2 ml-2 w-24"
      :title="`${t('videoEditor.fileManager.cardScale', 'Card scale')}: ${currentGridSizeName}`"
    >
      <UiWheelSlider
        :model-value="gridSizes.indexOf(filesPageStore.gridCardSize)"
        :min="0"
        :max="gridSizes.length - 1"
        :step="1"
        class="flex-1 w-full"
        @update:model-value="(v: number) => filesPageStore.setGridCardSize(gridSizes[v] || 130)"
      />
    </div>

    <div class="ml-auto flex items-center gap-2">
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
        v-model="filesPageStore.sortOption.field"
        :items="sortFields"
        value-key="value"
        size="xs"
        class="w-32"
      />
      <UiToggleButton
        :model-value="filesPageStore.sortOption.order === 'asc'"
        icon="i-heroicons-bars-arrow-down"
        active-icon="i-heroicons-bars-arrow-up"
        inactive-color="neutral"
        active-color="primary"
        size="xs"
        title="Sort order"
        no-toggle
        @click="
          filesPageStore.sortOption.order =
            filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc'
        "
      />
      <div class="w-px h-4 bg-ui-border mx-1"></div>
      <UiActionButton
        icon="i-heroicons-arrow-path"
        color="neutral"
        size="xs"
        title="Refresh"
        @click="emit('refresh')"
      />
      <UiToggleButton
        :model-value="uiStore.showHiddenFiles"
        icon="i-heroicons-eye"
        active-icon="i-heroicons-eye-slash"
        inactive-color="neutral"
        active-color="primary"
        size="xs"
        title="Show hidden files"
        @click="uiStore.showHiddenFiles = !uiStore.showHiddenFiles"
      />
    </div>
  </div>
</template>
