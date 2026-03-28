<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { useWindowSize } from '@vueuse/core';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const selectionStore = useSelectionStore();
const { width, height } = useWindowSize();

const isLandscape = computed(() => width.value > height.value);

const selectedEntity = computed(() => selectionStore.selectedEntity);

const isFileOrDirectory = computed(() => {
  return (
    selectedEntity.value?.source === 'fileManager' &&
    (selectedEntity.value.kind === 'file' || selectedEntity.value.kind === 'directory')
  );
});

const isMultiple = computed(() => {
  return selectedEntity.value?.source === 'fileManager' && selectedEntity.value.kind === 'multiple';
});

// Хендлер для закрытия при клике на оверлей
function handleOverlayClick() {
  emit('close');
}
</script>

<template>
  <div v-if="isOpen && selectedEntity" class="fixed inset-0 z-50 pointer-events-none">
    <!-- Overlay -->
    <div
      class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity pointer-events-auto"
      :class="[isOpen ? 'opacity-100' : 'opacity-0']"
      @click="handleOverlayClick"
    />

    <!-- Drawer Content -->
    <div
      class="absolute bg-slate-900 border-slate-800 shadow-2xl transition-transform duration-300 pointer-events-auto flex flex-col"
      :class="[
        isLandscape
          ? 'top-0 right-0 h-full w-80 border-l rounded-l-3xl'
          : 'bottom-0 left-0 w-full max-h-[80vh] border-t rounded-t-3xl',
        isOpen
          ? 'translate-x-0 translate-y-0'
          : isLandscape
            ? 'translate-x-full'
            : 'translate-y-full',
      ]"
    >
      <!-- Handle/Header -->
      <div class="flex items-center justify-center p-3 shrink-0">
        <div v-if="!isLandscape" class="w-12 h-1.5 bg-slate-700 rounded-full mb-1" />
        <div v-else class="flex justify-between items-center w-full px-2">
          <h3 class="font-bold text-lg">Properties</h3>
          <UButton icon="lucide:x" variant="ghost" color="neutral" @click="emit('close')" />
        </div>
      </div>

      <!-- Scrollable content -->
      <div class="flex-1 overflow-y-auto px-4 pb-10 custom-scrollbar">
        <div v-if="isFileOrDirectory" class="py-2">
          <FileProperties
            :selected-fs-entry="(selectedEntity as any).entry"
            preview-mode="original"
            :has-proxy="false"
          />
        </div>
        <div v-else-if="isMultiple" class="py-2">
          <MultiFileProperties :entries="(selectedEntity as any).entries" />
        </div>
      </div>

      <!-- Footer Action (Optional) -->
      <div v-if="!isLandscape" class="p-4 border-t border-slate-800 bg-slate-900/50">
        <UButton block color="neutral" variant="soft" label="Close" @click="emit('close')" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 10px;
}
</style>
