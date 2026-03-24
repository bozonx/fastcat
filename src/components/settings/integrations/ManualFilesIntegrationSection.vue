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

const fastcatPublicadorBaseUrl = computed(() => {
  const value = runtimeConfig.public.fastcatPublicadorBaseUrl;
  return typeof value === 'string' ? value.trim() : '';
});

const filesSourceLabel = computed(() => {
  const resolved = resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    fastcatPublicadorBaseUrl: fastcatPublicadorBaseUrl.value,
  });
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not configured');
  return resolved.source === 'fastcat_publicador'
    ? t('videoEditor.settings.integrationSourceFastCat', 'FastCat Publicador')
    : t('videoEditor.settings.integrationSourceManual', 'Manual API');
});

async function runHealth() {
  const resolved = resolveExternalServiceConfig({
    service: 'files',
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
          {{ t('videoEditor.settings.integrationFilesApi', 'Files API') }}
        </div>
        <div class="text-xs text-ui-text-muted mt-1">
          {{
            t(
              'videoEditor.settings.integrationFilesHint',
              'Manual file API can work standalone or override FastCat Publicador for file access. Health uses /api/v1/external/health.',
            )
          }}
        </div>
      </div>
      <div class="text-xs text-ui-text-muted shrink-0">
        {{ t('videoEditor.settings.integrationActiveSource', 'Active source') }}:
        {{ filesSourceLabel }}
      </div>
    </div>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.integrations.manualFilesApi.enabled" />
      <span class="text-sm text-ui-text">{{ t('common.enabled', 'Enabled') }}</span>
    </label>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox
        v-model="workspaceStore.userSettings.integrations.manualFilesApi.overrideFastCat"
      />
      <span class="text-sm text-ui-text">
        {{
          t(
            'videoEditor.settings.integrationOverrideFastCat',
            'Override FastCat Publicador for this service',
          )
        }}
      </span>
    </label>

    <UiFormField :label="t('videoEditor.settings.integrationBaseUrl', 'Base URL')">
      <UiTextInput
        v-model="workspaceStore.userSettings.integrations.manualFilesApi.baseUrl"
        full-width
        placeholder="https://api.example.com/api/v1/external/vfs"
      />
    </UiFormField>

    <UiFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
      <UiTextInput
        v-model="workspaceStore.userSettings.integrations.manualFilesApi.bearerToken"
        full-width
        type="password"
        autocomplete="off"
        placeholder="Bearer token"
      />
    </UiFormField>

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
