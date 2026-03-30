<script setup lang="ts">
import { formatBytes } from '~/utils/format';
import { useProjectStore } from '~/stores/project.store';

interface Breadcrumb {
  name: string;
  path: string;
}

const props = defineProps<{
  isSelectionMode: boolean;
  selectedCount: number;
  totalSelectedSize: number;
  breadcrumbs: Breadcrumb[];
  hasFolderPath: boolean;
  menuItems: any[];
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'cancel-selection'): void;
  (e: 'navigate-root'): void;
  (e: 'navigate-breadcrumb', name: string, path: string): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
</script>

<template>
  <div class="flex items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-3 py-2.5">
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
        {{ selectedCount }} {{ t('common.selected', 'Selected') }}
        <span v-if="totalSelectedSize > 0" class="ml-1 text-slate-400 font-normal">
          ({{ formatBytes(totalSelectedSize) }})
        </span>
      </div>
      <div
        v-else
        class="flex items-center gap-1 text-xs text-slate-400 overflow-x-auto no-scrollbar"
      >
        <button
          class="shrink-0 transition-colors py-1 px-1.5 -ml-1 rounded-md hover:bg-slate-800 hover:text-slate-100 truncate max-w-[100px]"
          @click="emit('navigate-root')"
        >
          {{ projectStore.currentProjectName || '/' }}
        </button>
        <template v-for="bc in breadcrumbs" :key="bc.path">
          <Icon name="lucide:chevron-right" class="w-2.5 h-2.5 opacity-30 shrink-0" />
          <button
            class="shrink-0 transition-colors py-1 px-1.5 rounded-md hover:bg-slate-800 hover:text-slate-100 last:text-slate-100 last:font-medium truncate max-w-[100px]"
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
