<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import UiModal from '~/components/ui/UiModal.vue';

const projectStore = useProjectStore();
const { t } = useI18n();

const isOpen = ref(false);

watch(
  () => projectStore.isReadOnly,
  (isReadOnly) => {
    if (isReadOnly) {
      isOpen.value = true;
    } else {
      isOpen.value = false;
    }
  },
  { immediate: true },
);

function handleClose() {
  isOpen.value = false;
}

async function handleStealLock() {
  await projectStore.stealProjectLock();
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.project.lockedTitle', 'Project Open in Another Tab')"
    :prevent-close="true"
    :close-button="false"
  >
    <div class="space-y-4">
      <div class="flex items-center gap-3 text-amber-500 mb-2">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 shrink-0" />
        <h3 class="font-bold">
          {{ t('videoEditor.project.lockedStatus', 'Concurrent Editing Detected') }}
        </h3>
      </div>

      <p class="text-sm text-ui-text-muted">
        {{
          t(
            'videoEditor.project.lockedDescription',
            'To prevent data corruption, only one tab can have write access to the project at a time.',
          )
        }}
      </p>
      <p class="text-sm text-ui-text-muted font-medium">
        {{
          t(
            'videoEditor.project.lockedSuggestion',
            'You can continue in Read-Only mode to view the project, or take control from the other tab to start editing here.',
          )
        }}
      </p>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton color="neutral" variant="ghost" @click="handleClose">
          {{ t('videoEditor.project.lockedAcknowledge', 'View Mode') }}
        </UButton>
        <UButton color="primary" variant="solid" @click="handleStealLock">
          {{ t('videoEditor.project.takeControl', 'Take Control Here') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
