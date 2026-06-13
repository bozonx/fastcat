<script setup lang="ts">
import { computed, ref } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import UiModal from '~/components/ui/UiModal.vue';

const { t } = useI18n();
const uiStore = useUiStore();

const showDetails = ref(false);

const isOpen = computed({
  get: () => uiStore.pendingRecoveryDialog !== null,
  set: (value) => {
    if (!value) {
      uiStore.pendingRecoveryDialog?.resolve('open-saved');
      uiStore.pendingRecoveryDialog = null;
    }
  },
});

const timelineName = computed(() => {
  const path = uiStore.pendingRecoveryDialog?.timelinePath;
  if (!path) return '';
  return path.split('/').pop() || path;
});

function handleChoice(choice: 'open-saved' | 'restore-autosave') {
  if (uiStore.pendingRecoveryDialog) {
    uiStore.pendingRecoveryDialog.resolve(choice);
    uiStore.pendingRecoveryDialog = null;
  }
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.timeline.backups.recoveryTitle')"
    :prevent-close="true"
    :close-button="false"
    :ui="{
      content: 'sm:max-w-md w-full',
    }"
  >
    <div class="space-y-4 pt-1">
      <p class="text-sm text-ui-text-muted leading-relaxed break-all">
        {{ t('videoEditor.timeline.backups.recoveryDescription', { name: timelineName }) }}
      </p>

      <div class="space-y-3 pt-2">
        <!-- 1. Restore Work (Recommended) -->
        <button
          autofocus
          class="w-full text-left p-3.5 rounded-xl border border-primary-500/30 bg-primary-950/10 hover:bg-primary-950/25 hover:border-primary-500/50 transition-all flex items-start gap-3.5 group focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          @click="handleChoice('restore-autosave')"
        >
          <div class="p-2 rounded-lg bg-primary-500/10 text-primary-500 shrink-0">
            <UIcon name="i-heroicons-arrow-path-solid" class="w-5 h-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div
              class="font-semibold text-ui-text group-hover:text-primary-400 transition-colors text-sm"
            >
              {{ t('videoEditor.timeline.backups.restoreAutosaveTitle') }}
            </div>
            <div class="text-xs text-ui-text-muted mt-1 leading-normal">
              {{ t('videoEditor.timeline.backups.restoreAutosaveDesc') }}
            </div>
          </div>
        </button>

        <!-- 2. Open Saved Version -->
        <button
          class="w-full text-left p-3.5 rounded-xl border border-ui-border bg-ui-bg hover:bg-ui-bg-elevated hover:border-ui-border-accent transition-all flex items-start gap-3.5 group focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          @click="handleChoice('open-saved')"
        >
          <div class="p-2 rounded-lg bg-ui-border-accent/10 text-ui-text-muted shrink-0">
            <UIcon name="i-heroicons-document-text" class="w-5 h-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div
              class="font-semibold text-ui-text group-hover:text-ui-text transition-colors text-sm"
            >
              {{ t('videoEditor.timeline.backups.openSavedTitle') }}
            </div>
            <div class="text-xs text-ui-text-muted mt-1 leading-normal">
              {{ t('videoEditor.timeline.backups.openSavedDesc') }}
            </div>
          </div>
        </button>
      </div>

      <!-- Learn more (for users worried about making a mistake) -->
      <div class="pt-1">
        <button
          class="inline-flex items-center gap-1 text-xs text-ui-text-muted hover:text-ui-text transition-colors focus:outline-none focus:text-ui-text cursor-pointer"
          :aria-expanded="showDetails"
          @click="showDetails = !showDetails"
        >
          <UIcon
            name="i-heroicons-chevron-right-20-solid"
            class="w-3.5 h-3.5 transition-transform"
            :class="{ 'rotate-90': showDetails }"
          />
          {{ t('videoEditor.timeline.backups.recoveryLearnMore') }}
        </button>

        <div
          v-if="showDetails"
          class="mt-2.5 space-y-2.5 text-xs text-ui-text-muted leading-relaxed border-l-2 border-ui-border pl-3"
        >
          <p>{{ t('videoEditor.timeline.backups.recoveryLearnMoreRestore') }}</p>
          <p>{{ t('videoEditor.timeline.backups.recoveryLearnMoreOpen') }}</p>
          <p class="text-ui-text">
            {{ t('videoEditor.timeline.backups.recoveryLearnMoreBackups') }}
          </p>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
@reference "tailwindcss";
</style>
