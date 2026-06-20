<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import type { useMobileAssetCategories } from '~/composables/file-manager/useMobileAssetCategories';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import MobileFileBrowserGrid from './MobileFileBrowserGrid.vue';
import MobileFileBrowserList from './MobileFileBrowserList.vue';
import MobilePullToRefreshIndicator from './MobilePullToRefreshIndicator.vue';

type AssetCategories = ReturnType<typeof useMobileAssetCategories>['categories'];

const props = withDefaults(
  defineProps<{
    categories: AssetCategories;
    selectedEntries: FsEntry[];
    isSelectionMode: boolean;
    isCollapsed: (id: AssetCategories[number]['id']) => boolean;
    selectedEntryPath?: string | null;
    isPulling?: boolean;
    isRefreshing?: boolean;
    pullDistance?: number;
  }>(),
  {
    selectedEntryPath: null,
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
  },
);

const emit = defineEmits<{
  (e: 'entry-click', entry: FsEntry): void;
  (e: 'long-press', entry: FsEntry): void;
  (e: 'toggle-selection', entry: FsEntry): void;
  (e: 'toggle-collapse', id: AssetCategories[number]['id']): void;
  (e: 'retry', id: AssetCategories[number]['id']): void;
  (e: 'touch-start', event: TouchEvent): void;
  (e: 'touch-move', event: TouchEvent): void;
  (e: 'touch-end'): void;
}>();

const EMPTY_FOLDER_SIZES: Record<string, number> = {};

function compatibilityFor(
  value: Record<string, FileCompatibility>,
): Record<string, FileCompatibility> {
  return value;
}
</script>

<template>
  <div
    class="flex-1 overflow-y-auto min-h-0 relative"
    @touchstart="emit('touch-start', $event)"
    @touchmove="emit('touch-move', $event)"
    @touchend="emit('touch-end')"
  >
    <MobilePullToRefreshIndicator
      :is-pulling="isPulling"
      :is-refreshing="isRefreshing"
      :pull-distance="pullDistance"
    />

    <section
      v-for="category in categories"
      v-show="
        category.sortedEntries.value.length > 0 || category.isLoading.value || category.error.value
      "
      :key="category.id"
      class="border-b border-ui-border/50"
    >
      <button
        class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-ui-bg-elevated"
        @click="emit('toggle-collapse', category.id)"
      >
        <Icon
          name="lucide:chevron-right"
          class="w-4 h-4 shrink-0 text-ui-text-muted transition-transform"
          :class="{ 'rotate-90': !props.isCollapsed(category.id) }"
        />
        <Icon :name="category.icon" class="w-5 h-5 shrink-0 text-ui-text-muted" />
        <span class="text-sm font-semibold">{{ $t(category.labelKey) }}</span>
        <span class="ml-auto text-xs tabular-nums text-ui-text-muted">
          {{ category.sortedEntries.value.length }}
        </span>
      </button>

      <component
        :is="
          ['audio', 'documents', 'files'].includes(category.id)
            ? MobileFileBrowserList
            : MobileFileBrowserGrid
        "
        v-show="!props.isCollapsed(category.id)"
        :entries="category.sortedEntries.value"
        :thumbnails="category.thumbnails.value"
        :file-compatibility="compatibilityFor(category.fileCompatibility.value)"
        :selected-entry-path="selectedEntryPath"
        :selected-entries="selectedEntries"
        :is-selection-mode="isSelectionMode"
        :is-loading="category.isLoading.value"
        :error="category.error.value"
        :folder-sizes="EMPTY_FOLDER_SIZES"
        @entry-click="emit('entry-click', $event)"
        @long-press="emit('long-press', $event)"
        @toggle-selection="emit('toggle-selection', $event)"
        @retry="emit('retry', category.id)"
      />
    </section>
  </div>
</template>
