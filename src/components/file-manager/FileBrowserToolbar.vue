<script setup lang="ts">
import { useFilesPageStore, type FileSortField } from '~/stores/filesPage.store';
import { useUiStore } from '~/stores/ui.store';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

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
      <UButton
        :color="filesPageStore.viewMode === 'grid' ? 'primary' : 'neutral'"
        variant="ghost"
        icon="i-heroicons-squares-2x2"
        size="sm"
        @click="filesPageStore.setViewMode('grid')"
      />
      <UButton
        :color="filesPageStore.viewMode === 'list' ? 'primary' : 'neutral'"
        variant="ghost"
        icon="i-heroicons-list-bullet"
        size="sm"
        @click="filesPageStore.setViewMode('list')"
      />
    </div>

    <!-- Card size slider (only in grid view) -->
    <div
      v-if="filesPageStore.viewMode === 'grid'"
      class="flex items-center gap-2 ml-2 w-24"
      :title="`${t('videoEditor.fileManager.cardScale', 'Масштаб карточек')}: ${currentGridSizeName}`"
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
      <UButton
        v-if="remoteAvailable"
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-heroicons-cloud"
        @click="emit('openRemote')"
      >
        Remote
      </UButton>
      <span class="text-xs text-ui-text-muted">{{ t('common.sortBy', 'Sort by') }}:</span>
      <USelectMenu
        v-model="filesPageStore.sortOption.field"
        :items="sortFields"
        value-key="value"
        size="xs"
        class="w-32"
        :search-input="false"
      />
      <UButton
        :icon="
          filesPageStore.sortOption.order === 'asc'
            ? 'i-heroicons-bars-arrow-up'
            : 'i-heroicons-bars-arrow-down'
        "
        variant="ghost"
        color="neutral"
        size="xs"
        @click="
          filesPageStore.sortOption.order =
            filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc'
        "
      />
      <div class="w-px h-4 bg-ui-border mx-1"></div>
      <UButton
        icon="i-heroicons-arrow-path"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree')"
        @click="emit('refresh')"
      />
      <UButton
        :icon="uiStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="
          uiStore.showHiddenFiles
            ? t('videoEditor.fileManager.actions.hideHiddenFiles', 'Hide hidden files')
            : t('videoEditor.fileManager.actions.showHiddenFiles', 'Show hidden files')
        "
        @click="uiStore.showHiddenFiles = !uiStore.showHiddenFiles"
      />
    </div>
  </div>
</template>
