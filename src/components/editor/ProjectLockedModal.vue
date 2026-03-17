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
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.project.lockedTitle', 'Project Locked')"
    :prevent-close="true"
    :close-button="false"
  >
    <div class="space-y-4">
      <p class="text-sm text-ui-text-muted">
        {{ t('videoEditor.project.lockedDescription') }}
      </p>
      <p class="text-sm text-ui-text-muted">
        {{ t('videoEditor.project.lockedSuggestion') }}
      </p>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <UButton color="neutral" variant="solid" @click="handleClose">
          {{ t('videoEditor.project.lockedAcknowledge', 'Understood, Read-Only') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
