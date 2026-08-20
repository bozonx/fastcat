<script setup lang="ts">
import { formatBytes } from '~/utils/format';
import { dropdownNoReturnFocus } from '~/composables/useDropdownMenuFocus';
import { useProjectStore } from '~/stores/project.store';
import type { ContextMenuItem } from '~/composables/file-manager/useFileContextMenu';

interface Breadcrumb {
  name: string;
  path: string;
}

defineProps<{
  isSelectionMode: boolean;
  selectedCount: number;
  totalSelectedSize: number;
  breadcrumbs: Breadcrumb[];
  hasFolderPath: boolean;
  menuItems: ContextMenuItem[] | ContextMenuItem[][];
}>();

const emit = defineEmits<{
  (e: 'back' | 'cancel-selection' | 'navigate-root'): void;
  (e: 'navigate-breadcrumb', name: string, path: string): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
</script>

<template>
  <div
    class="mobile-file-browser-navbar flex items-center gap-2 border-b border-ui-border bg-ui-bg-elevated/50 px-3 py-2.5"
  >
    <UButton
      v-if="hasFolderPath && !isSelectionMode"
      icon="lucide:chevron-left"
      variant="ghost"
      color="neutral"
      size="sm"
      @click="emit('back')"
    />
    <UButton
      v-if="isSelectionMode"
      icon="lucide:x"
      variant="ghost"
      color="neutral"
      size="sm"
      @click="emit('cancel-selection')"
    />

    <div class="flex-1 overflow-x-hidden">
      <div v-if="isSelectionMode" class="font-medium text-sm px-2 truncate">
        {{ selectedCount }} {{ t('common.selected') }}
        <span v-if="totalSelectedSize > 0" class="ml-1 text-ui-text-muted font-normal">
          ({{ formatBytes(totalSelectedSize) }})
        </span>
      </div>
      <div
        v-else
        class="flex items-center gap-1 text-xs text-ui-text-muted overflow-x-auto no-scrollbar"
      >
        <button
          :title="projectStore.currentProjectName || '/'"
          class="shrink-0 transition-colors py-1 px-1.5 -ml-1 rounded-md hover:bg-ui-bg-muted hover:text-ui-text truncate max-w-[100px]"
          @click="emit('navigate-root')"
        >
          {{ projectStore.currentProjectName || '/' }}
        </button>
        <template v-for="bc in breadcrumbs" :key="bc.path">
          <Icon name="lucide:chevron-right" class="w-2.5 h-2.5 opacity-30 shrink-0" />
          <button
            :title="bc.name"
            class="shrink-0 transition-colors py-1 px-1.5 rounded-md hover:bg-ui-bg-muted hover:text-ui-text last:text-ui-text last:font-medium truncate max-w-[100px]"
            @click="emit('navigate-breadcrumb', bc.name, bc.path)"
          >
            {{ bc.name }}
          </button>
        </template>
      </div>
    </div>

    <div class="shrink-0 flex items-center ml-2">
      <UDropdownMenu
        v-if="!isSelectionMode"
        :items="menuItems"
        :ui="{ content: 'w-56 min-w-max' }"
        :content="dropdownNoReturnFocus"
      >
        <UButton icon="lucide:more-vertical" variant="ghost" color="neutral" size="sm" />
      </UDropdownMenu>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
