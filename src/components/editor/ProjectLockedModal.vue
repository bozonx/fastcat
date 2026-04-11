<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import UiModal from '~/components/ui/UiModal.vue';

const projectStore = useProjectStore();
const { t } = useI18n();
const route = useRoute();

const isMobile = computed(() => route.path.startsWith('/m'));

const isOpen = ref(false);
const isStealing = ref(false);

const modalUi = computed(() => {
  if (isMobile.value) {
    return {
      content:
        'max-w-full m-0 rounded-t-[2.5rem] rounded-b-none fixed bottom-0 top-auto h-auto min-h-[40vh] bg-zinc-950 border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]',
      body: 'pb-12 pt-8 px-6',
      header: 'pt-6 px-6 border-none text-xl font-bold',
      footer: 'px-6 pb-12 pt-0 bg-transparent border-none',
    };
  }
  return {};
});

watch(
  () => projectStore.isReadOnly,

  (isReadOnly) => {
    if (isReadOnly) {
      isOpen.value = true;
    } else {
      isOpen.value = false;
      isStealing.value = false;
    }
  },
  { immediate: true },
);

function handleClose() {
  isOpen.value = false;
}

async function handleStealLock() {
  if (!projectStore.currentProjectId || isStealing.value) return;

  isStealing.value = true;
  try {
    console.log('[ProjectLockedModal] Initiating steal lock sequence...');
    await projectStore.stealProjectLock();
    console.log('[ProjectLockedModal] Steal sequence finished.');
  } catch (e) {
    console.error('[ProjectLockedModal] Error steal lock:', e);
  } finally {
    // If stealing failed or took too long, we must allow the user to try again
    // If it succeeded, the isReadOnly watcher will close the modal anyway
    setTimeout(() => {
      isStealing.value = false;
    }, 1000);
  }
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.project.lockedTitle')"
    :prevent-close="true"
    :close-button="false"
    :ui="modalUi"
  >
    <div class="space-y-4">
      <div class="flex items-center gap-3 text-amber-500 mb-2">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 shrink-0" />
        <h3 class="font-bold">
          {{ t('videoEditor.project.lockedStatus') }}
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
      <div class="flex flex-col sm:flex-row justify-end gap-3 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :class="isMobile ? 'h-14 rounded-2xl order-2 sm:order-1' : ''"
          :disabled="isStealing"
          @click="handleClose"
        >
          {{ t('videoEditor.project.lockedAcknowledge') }}
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          :class="isMobile ? 'h-14 rounded-2xl order-1 sm:order-2' : ''"
          :loading="isStealing"
          @click="handleStealLock"
        >
          {{ t('videoEditor.project.takeControl') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
