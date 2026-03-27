<script setup lang="ts">
import { reactive, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiAccordion from '~/components/ui/UiAccordion.vue';

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
    // If enabled, we probably also want to override BloggerDog by default
    if (val) {
      workspaceStore.userSettings.integrations.manualSttApi.overrideFastCat = true;
    }
  },
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
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not connected');
  return resolved.source === 'fastcat_publicador'
    ? t('videoEditor.settings.integrationSourceBloggerDog', 'Through BloggerDog')
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
  <UiAccordion
    :title="t('videoEditor.settings.integrationSttApi', 'STT API')"
    :summary="sttSourceLabel"
    :force-open="isManualSttEnabled"
  >
    <div class="flex flex-col gap-4 pt-2">
      <div class="text-xs text-ui-text-muted">
        {{
          t(
            'videoEditor.settings.integrationSttHint',
            'Manual STT API can work standalone or override BloggerDog for speech recognition.',
          )
        }}
      </div>

      <label class="flex items-center gap-3 cursor-pointer">
        <UCheckbox v-model="isManualSttEnabled" />
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.integrationSttUseOwn', 'Use own API') }}
        </span>
      </label>

      <div
        v-show="isManualSttEnabled"
        class="flex flex-col gap-4 border-l-2 border-primary-500/30 pl-4 py-1"
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

        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="workspaceStore.userSettings.integrations.stt.restorePunctuation" />
            <span class="text-sm text-ui-text">
              {{
                t('videoEditor.settings.integrationSttRestorePunctuation', 'Restore punctuation')
              }}
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
        </div>

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
    </div>
  </UiAccordion>
</template>
