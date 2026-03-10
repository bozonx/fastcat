<template>
  <UModal v-model="isOpen" prevent-close>
    <UCard :ui="{ ring: '', divide: 'divide-y divide-gray-100 dark:divide-gray-800' }">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold leading-6 text-gray-900 dark:text-white">
            Project Locked
          </h3>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          This project is currently open in another tab or browser window. Concurrent editing of the
          same project is not supported and may lead to data loss or conflicts.
        </p>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          You can continue in <b>Read-Only</b> mode to view the project, but we recommend returning
          to your original tab for editing.
        </p>
      </div>

      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton color="white" variant="solid" @click="handleClose">
            Understood, Read-Only
          </UButton>
        </div>
      </template>
    </UCard>
  </UModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';

const projectStore = useProjectStore();
const isOpen = ref(false);

watch(
  () => projectStore.isReadOnly,
  (isReadOnly) => {
    if (isReadOnly) {
      isOpen.value = true;
    }
  },
  { immediate: true },
);

function handleClose() {
  isOpen.value = false;
}
</script>
