<script setup lang="ts">
import { reactive, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
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

const fastcatPublicadorBaseUrl = computed(() => {
  const value = runtimeConfig.public.fastcatPublicadorBaseUrl;
  return typeof value === 'string' ? value.trim() : '';
});

const sttSourceLabel = computed(() => {
  const resolved = resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    fastcatPublicadorBaseUrl: fastcatPublicadorBaseUrl.value,
  });
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not configured');
  return resolved.source === 'fastcat_publicador'
    ? t('videoEditor.settings.integrationSourceFastCat', 'FastCat Publicador')
    : t('videoEditor.settings.integrationSourceManual', 'Manual API');
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
    fastcatPublicadorBaseUrl: fastcatPublicadorBaseUrl.value,
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
  <div class="rounded-lg border border-ui-border p-4 flex flex-col gap-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.integrationSttApi', 'STT API') }}
        </div>
        <div class="text-xs text-ui-text-muted mt-1">
          {{
            t(
              'videoEditor.settings.integrationSttHint',
              'Manual STT API can work standalone or override FastCat Publicador for speech recognition. Health uses /api/v1/external/health.',
            )
          }}
        </div>
      </div>
      <div class="text-xs text-ui-text-muted shrink-0">
        {{ t('videoEditor.settings.integrationActiveSource', 'Active source') }}:
        {{ sttSourceLabel }}
      </div>
    </div>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.integrations.manualSttApi.enabled" />
      <span class="text-sm text-ui-text">{{ t('common.enabled', 'Enabled') }}</span>
    </label>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.integrations.manualSttApi.overrideFastCat" />
      <span class="text-sm text-ui-text">
        {{
          t(
            'videoEditor.settings.integrationOverrideFastCat',
            'Override FastCat Publicador for this service',
          )
        }}
      </span>
    </label>

    <UFormField :label="t('videoEditor.settings.integrationBaseUrl', 'Base URL')">
      <UInput
        v-model="workspaceStore.userSettings.integrations.manualSttApi.baseUrl"
        class="w-full"
        placeholder="https://api.example.com/api/v1/external/stt"
      />
    </UFormField>

    <UFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
      <UInput
        v-model="workspaceStore.userSettings.integrations.manualSttApi.bearerToken"
        class="w-full"
        type="password"
        autocomplete="off"
        placeholder="Bearer token"
      />
    </UFormField>

    <UFormField :label="t('videoEditor.settings.integrationSttProvider', 'Provider')">
      <UInput
        v-model="workspaceStore.userSettings.integrations.stt.provider"
        class="w-full"
        placeholder="assemblyai"
      />
    </UFormField>

    <UFormField :label="t('videoEditor.settings.integrationSttModels', 'Models')">
      <UInput v-model="sttModelsText" class="w-full" placeholder="universal-3-pro, universal-2" />
    </UFormField>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.integrations.stt.restorePunctuation" />
      <span class="text-sm text-ui-text">
        {{ t('videoEditor.settings.integrationSttRestorePunctuation', 'Restore punctuation') }}
      </span>
    </label>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.integrations.stt.formatText" />
      <span class="text-sm text-ui-text">
        {{ t('videoEditor.settings.integrationSttFormatText', 'Format text') }}
      </span>
    </label>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.integrations.stt.includeWords" />
      <span class="text-sm text-ui-text">
        {{ t('videoEditor.settings.integrationSttIncludeWords', 'Include word timestamps') }}
      </span>
    </label>

    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="soft" :loading="healthState.loading" @click="runHealth">
        {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
      </UButton>
    </div>

    <div class="text-xs" :class="getHealthTone(healthState.status)">
      {{
        healthState.message ||
        t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check')
      }}
    </div>
  </div>
</template>
