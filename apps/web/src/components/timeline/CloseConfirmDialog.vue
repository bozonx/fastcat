<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const { t } = useI18n();
const uiStore = useUiStore();

// Promise-based: `pendingCloseDialog` is set by the window-close handler, which
// awaits the user's choice. Dismissing the modal (backdrop / escape / Cancel)
// resolves as 'cancel' so the window stays open; never a silent discard.
const isOpen = computed({
  get: () => uiStore.pendingCloseDialog !== null,
  set: (value) => {
    if (!value && uiStore.pendingCloseDialog) {
      uiStore.pendingCloseDialog.resolve('cancel');
      uiStore.pendingCloseDialog = null;
    }
  },
});

const description = computed(() =>
  (uiStore.pendingCloseDialog?.dirtyCount ?? 0) > 1
    ? t('videoEditor.timeline.closeUnsavedMessageMultiple')
    : t('videoEditor.timeline.confirmCloseAppMessage'),
);

function resolve(choice: 'save' | 'dont-save') {
  if (uiStore.pendingCloseDialog) {
    uiStore.pendingCloseDialog.resolve(choice);
    uiStore.pendingCloseDialog = null;
  }
}
</script>

<template>
  <UiConfirmModal
    v-model:open="isOpen"
    :title="t('videoEditor.timeline.confirmCloseUnsavedTitle')"
    :description="description"
    :confirm-text="t('common.save')"
    :secondary-text="t('common.dontSave')"
    :cancel-text="t('common.cancel')"
    color="primary"
    secondary-color="error"
    icon="i-heroicons-exclamation-triangle"
    @confirm="resolve('save')"
    @secondary="resolve('dont-save')"
  />
</template>
