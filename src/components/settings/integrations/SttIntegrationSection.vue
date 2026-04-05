<script setup lang="ts">
import { reactive, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import {
  resolveExternalServiceConfig,
  runExternalHealthCheck,
} from '~/utils/external-integrations';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const runtimeConfig = useRuntimeConfig();

const healthState = reactive({
  loading: false,
  status: 'idle' as 'idle' | 'success' | 'error',
  message: '',
});

const isManualSttEnabled = computed({
  get: () => workspaceStore.userSettings.integrations.manualSttApi.enabled,
  set: (val: boolean) => {
    workspaceStore.userSettings.integrations.manualSttApi.enabled = val;
    if (val) {
      workspaceStore.userSettings.integrations.manualSttApi.overrideFastCat = true;
    }
  },
});

const isFastcatConnected = computed(() => {
  const acc = workspaceStore.userSettings.integrations.fastcatAccount;
  return acc.enabled && acc.bearerToken.trim() !== '';
});

const sttModelsText = computed({
  get: () => workspaceStore.userSettings.integrations.stt.models.join(', '),
  set: (value: string) => {
    workspaceStore.userSettings.integrations.stt.models = value
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
  },
});

async function runHealth() {
  const resolved = resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl: '', // BloggerDog removed for STT
    fastcatAccountApiUrl: runtimeConfig.public.fastcatAccountApiUrl as string,
  });

  if (!resolved) {
    healthState.status = 'error';
    healthState.message = t(
      'videoEditor.settings.integrationHealthUnavailable',
      'No active integration is configured for this service.',
    );
    return;
  }

  healthState.loading = true;
  healthState.status = 'idle';
  healthState.message = '';

  try {
    const result = await runExternalHealthCheck({
      url: resolved.healthUrl,
      bearerToken: resolved.bearerToken,
    });
    healthState.status = 'success';
    healthState.message = `${t('videoEditor.settings.integrationHealthOk', 'OK')} (${result.status})`;
  } catch (error: unknown) {
    healthState.status = 'error';
    healthState.message = error instanceof Error ? error.message : 'Health check failed';
  } finally {
    healthState.loading = false;
  }
}

function getHealthTone(status: typeof healthState.status) {
  if (status === 'success') return 'text-success-400';
  if (status === 'error') return 'text-error-400';
  return 'text-ui-text-muted';
}
</script>

<template>
  <div class="flex flex-col gap-4 border border-ui-border rounded-lg p-4">
    <div class="flex flex-col gap-1">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.sttTranscriptionSettings', 'Transcription settings') }}
      </div>
      <div class="text-xs text-ui-text-muted">
        {{ t('videoEditor.settings.sttTranscriptionDescription', 'Configure speech-to-text integration and defaults.') }}
      </div>
    </div>

    <div class="flex p-0.5 bg-ui-bg-muted rounded-lg w-full">
      <button
        type="button"
        :class="[
          !isManualSttEnabled
            ? isFastcatConnected 
              ? 'bg-primary-500 text-white shadow-sm' 
              : 'bg-error-500 text-white shadow-sm'
            : 'text-ui-text-muted hover:text-ui-text',
        ]"
        class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2"
        @click="isManualSttEnabled = false"
      >
        <UIcon v-if="!isFastcatConnected" name="i-heroicons-link-slash" class="w-3.5 h-3.5" />
        {{ t('videoEditor.settings.sttFastcat', 'FASTCAT STT') }}
      </button>
      <button
        type="button"
        :class="[
          isManualSttEnabled
            ? healthState.status === 'error'
              ? 'bg-error-500 text-white shadow-sm'
              : 'bg-primary-500 text-white shadow-sm'
            : 'text-ui-text-muted hover:text-ui-text',
        ]"
        class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
        @click="isManualSttEnabled = true"
      >
        {{ t('videoEditor.settings.sttCustom', 'Custom STT') }}
      </button>
    </div>

    <!-- Manual STT Form -->
    <div
      v-if="isManualSttEnabled"
      class="flex flex-col gap-4 border border-ui-border rounded-lg p-4 bg-ui-bg-muted/30"
    >
      <UiFormField :label="t('videoEditor.settings.integrationBaseUrl', 'Base URL')">
        <UiTextInput
          v-model="workspaceStore.userSettings.integrations.manualSttApi.baseUrl"
          full-width
          placeholder="https://api.example.com/api/v1/external/stt"
        />
      </UiFormField>

      <UiFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
        <UiTextInput
          v-model="workspaceStore.userSettings.integrations.manualSttApi.bearerToken"
          full-width
          type="password"
          autocomplete="off"
          placeholder="Bearer token"
        />
      </UiFormField>

      <div class="flex flex-wrap items-center gap-3 mt-2 border-t border-ui-border pt-4">
        <UButton
          color="neutral"
          variant="soft"
          size="sm"
          :loading="healthState.loading"
          @click="runHealth"
        >
          {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
        </UButton>
        <div
          v-if="healthState.status === 'error'"
          class="text-xs text-error-400"
        >
          {{ healthState.message }}
        </div>
        <div
          v-else-if="healthState.status === 'success'"
          class="text-xs text-success-400"
        >
          {{ t('videoEditor.settings.integrationHealthOk', 'Connected') }}
        </div>
      </div>
    </div>

    <!-- Shared STT Settings -->
    <div class="flex flex-col gap-4 pl-1">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UiFormField :label="t('videoEditor.settings.integrationSttProvider', 'Provider')">
          <UiTextInput
            v-model="workspaceStore.userSettings.integrations.stt.provider"
            full-width
            placeholder="assemblyai"
          />
        </UiFormField>

        <UiFormField :label="t('videoEditor.settings.integrationSttModels', 'Models')">
          <UiTextInput
            v-model="sttModelsText"
            full-width
            placeholder="universal-3-pro, universal-2"
          />
        </UiFormField>
      </div>
    </div>
  </div>
</template>
