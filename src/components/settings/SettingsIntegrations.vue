<script setup lang="ts">
import { ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileBrowserPersistenceStore } from '~/stores/file-manager.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';


import FastcatAccountSection from './integrations/FastcatAccountSection.vue';
import BloggerDogSection from './integrations/BloggerDogSection.vue';
import SttIntegrationSection from './integrations/SttIntegrationSection.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const fileBrowserPersistence = useFileBrowserPersistenceStore();
const route = useRoute();
const router = useRouter();


const isResetConfirmOpen = ref(false);
const showSuccessMessage = ref(false);

function resetDefaults() {
  workspaceStore.userSettings.integrations = {
    fastcatAccount: { ...DEFAULT_USER_SETTINGS.integrations.fastcatAccount },
    fastcatPublicador: { ...DEFAULT_USER_SETTINGS.integrations.fastcatPublicador },
    manualFilesApi: { ...DEFAULT_USER_SETTINGS.integrations.manualFilesApi },
    stt: {
      ...DEFAULT_USER_SETTINGS.integrations.stt,
      models: [...DEFAULT_USER_SETTINGS.integrations.stt.models],
    },
  };

  isResetConfirmOpen.value = false;
}

watch(
  () => route.query.token,
  async (token) => {
    if (typeof token !== 'string' || token.trim().length === 0) return;

    const target = (route.query.target || route.query.state) as string;
    
    if (!target) {
      console.warn('[Integrations] Received token but no target/state found in query:', route.query);
    }

    await workspaceStore.batchUpdateUserSettings((draft) => {
      // If we have an explicit target, use it
      if (target === 'fastcat') {
        draft.integrations.fastcatAccount.bearerToken = token.trim();
        draft.integrations.fastcatAccount.enabled = true;
      } else if (target === 'bloggerdog') {
        draft.integrations.fastcatPublicador.bearerToken = token.trim();
        draft.integrations.fastcatPublicador.enabled = true;
      } 
      // Fallback: if only one integration exists or if one is clearly "in progress" 
      // (but we don't have that state yet). 
      // For now, let's just log and skip if target is unknown to avoid corruption.
    }, { immediate: true });

    // Explicitly flush to be 100% sure before showing success
    await workspaceStore.flushSettingsSaves();

    showSuccessMessage.value = true;

    const nextQuery = { ...route.query };
    delete nextQuery.token;
    delete nextQuery.target;
    delete nextQuery.state;

    await router.replace({ query: nextQuery });
  },
  { immediate: true },
);

// Switch to fastcat tab when integrated
watch(
  () => workspaceStore.userSettings?.integrations?.fastcatAccount?.bearerToken,
  (token) => {
    if (token && token.trim().length > 0) {
      fileBrowserPersistence.setFilesPageActiveTab('fastcat');
    }
  }
);

</script>

<template>
  <div class="flex flex-col gap-6">
    <UAlert
      v-if="showSuccessMessage"
      color="success"
      variant="soft"
      icon="i-heroicons-check-circle"
      :title="t('videoEditor.settings.integrationSuccessTitle')"
      :description="t('videoEditor.settings.integrationSuccessDesc')"
      class="mb-2"
    />

    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="
        t('videoEditor.settings.resetIntegrationsSettingsConfirmTitle')
      "
      :description="
        t(
          'videoEditor.settings.resetIntegrationsSettingsConfirmDesc',
          'This will restore all integration settings to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="font-semibold text-ui-text">
        {{ t('videoEditor.settings.userIntegrations') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <FastcatAccountSection />

    <BloggerDogSection />

    <SttIntegrationSection />
  </div>
</template>
