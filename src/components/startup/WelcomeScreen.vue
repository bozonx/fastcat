<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const isTauriWorkspace = computed(() => workspaceStore.workspaceProviderId === 'tauri');
</script>

<template>
  <div
    class="flex flex-col items-center justify-center flex-1 bg-linear-to-br from-primary-950 via-ui-bg-elevated to-black p-6"
  >
    <div
      class="max-w-md w-full text-center space-y-6 bg-ui-bg-elevated/50 p-8 rounded-2xl backdrop-blur-sm border border-ui-border/50 shadow-2xl"
    >
      <div
        class="mx-auto w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center mb-6"
      >
        <UIcon name="i-heroicons-film" class="w-8 h-8 text-primary-400" />
      </div>

      <h1
        class="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary-300 to-primary-200"
      >
        Gran Video Editor
      </h1>

      <p class="text-ui-text-muted">
        {{
          isTauriWorkspace
            ? t(
                'granVideoEditor.welcome.selectTauriWorkspace',
                'Select a workspace folder on your computer. Gran Video Editor will store projects, source media, proxies, and cache in this folder.',
              )
            : t(
                'granVideoEditor.welcome.selectWebWorkspace',
                'Select a workspace folder on your computer. Your browser will ask for access to store project files, media proxies, and cache.',
              )
        }}
      </p>

      <div
        v-if="workspaceStore.error"
        class="text-error-400 text-sm bg-error-400/10 p-3 rounded-lg border border-error-400/20"
      >
        {{ workspaceStore.error }}
      </div>

      <UButton
        v-if="workspaceStore.isApiSupported"
        size="lg"
        variant="solid"
        color="primary"
        icon="i-heroicons-folder-open"
        class="w-full justify-center transition-all hover:scale-[1.02]"
        :label="t('granVideoEditor.welcome.openWorkspace', 'Select Workspace Folder')"
        :loading="workspaceStore.isLoading"
        :disabled="workspaceStore.isLoading"
        @click="workspaceStore.openWorkspace"
      />
      <div v-else class="text-orange-400 text-sm">
        {{
          t(
            'granVideoEditor.fileManager.unsupported',
            'Workspace selection is not supported in this environment',
          )
        }}
      </div>
    </div>
  </div>
</template>
