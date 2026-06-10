<script setup lang="ts">
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('ProjectReadOnlyBanner');
const projectStore = useProjectStore();
const { t } = useI18n();

const isStealing = ref(false);

async function handleStealLock() {
  if (!projectStore.currentProjectId || isStealing.value) return;

  isStealing.value = true;
  try {
    log.log('Initiating steal lock from banner...');
    await projectStore.stealProjectLock();
  } catch (e) {
    log.error('Error steal lock from banner:', e);
  } finally {
    setTimeout(() => {
      isStealing.value = false;
    }, 1000);
  }
}
</script>

<template>
  <div
    v-if="projectStore.isReadOnly && projectStore.currentProjectName"
    class="shrink-0 flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20"
  >
    <UIcon
      name="i-heroicons-exclamation-triangle"
      class="w-5 h-5 shrink-0 text-amber-500"
    />
    <span class="flex-1 text-sm text-amber-200">
      {{ t('videoEditor.project.readOnlyBannerText') }}
    </span>
    <UButton
      size="xs"
      color="primary"
      variant="soft"
      class="text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50"
      :loading="isStealing"
      @click="handleStealLock"
    >
      {{ t('videoEditor.project.takeControl') }}
    </UButton>
  </div>
</template>
