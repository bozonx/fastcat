<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings';
import {
  getGranPublicadorConnectUrl,
  getGranPublicadorHealthUrl,
  resolveExternalIntegrations,
  resolveExternalServiceConfig,
  runExternalHealthCheck,
} from '~/utils/external-integrations';

interface HealthState {
  loading: boolean;
  status: 'idle' | 'success' | 'error';
  message: string;
}

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const healthStates = reactive<Record<'gran' | 'files' | 'stt', HealthState>>({
  gran: { loading: false, status: 'idle', message: '' },
  files: { loading: false, status: 'idle', message: '' },
  stt: { loading: false, status: 'idle', message: '' },
});

const integrations = computed(() => workspaceStore.userSettings.integrations);
const resolvedServices = computed(() =>
  resolveExternalIntegrations({ userSettings: workspaceStore.userSettings }),
);

const redirectUri = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${route.path}`;
});

const granConnectUrl = computed(() =>
  getGranPublicadorConnectUrl({
    baseUrl: integrations.value.granPublicador.baseUrl,
    name: integrations.value.granPublicador.connectName,
    redirectUri: redirectUri.value,
  }),
);

const filesSourceLabel = computed(() => {
  const resolved = resolvedServices.value.files;
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not configured');
  return resolved.source === 'gran_publicador'
    ? t('videoEditor.settings.integrationSourceGran', 'Gran Publicador')
    : t('videoEditor.settings.integrationSourceManual', 'Manual API');
});

const sttSourceLabel = computed(() => {
  const resolved = resolvedServices.value.stt;
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not configured');
  return resolved.source === 'gran_publicador'
    ? t('videoEditor.settings.integrationSourceGran', 'Gran Publicador')
    : t('videoEditor.settings.integrationSourceManual', 'Manual API');
});

function resetDefaults() {
  workspaceStore.userSettings.integrations = {
    granPublicador: { ...DEFAULT_USER_SETTINGS.integrations.granPublicador },
    manualFilesApi: { ...DEFAULT_USER_SETTINGS.integrations.manualFilesApi },
    manualSttApi: { ...DEFAULT_USER_SETTINGS.integrations.manualSttApi },
  };

  for (const state of Object.values(healthStates)) {
    state.loading = false;
    state.status = 'idle';
    state.message = '';
  }
}

function disconnectGran() {
  workspaceStore.userSettings.integrations.granPublicador.enabled = false;
  workspaceStore.userSettings.integrations.granPublicador.bearerToken = '';
  healthStates.gran.status = 'idle';
  healthStates.gran.message = '';
}

function startGranConnect() {
  if (!granConnectUrl.value) return;
  window.location.assign(granConnectUrl.value);
}

watch(
  () => route.query.token,
  async (token) => {
    if (typeof token !== 'string' || token.trim().length === 0) return;

    workspaceStore.userSettings.integrations.granPublicador.bearerToken = token.trim();
    workspaceStore.userSettings.integrations.granPublicador.enabled = true;
    healthStates.gran.status = 'success';
    healthStates.gran.message = t(
      'videoEditor.settings.integrationTokenReceived',
      'Token received from Gran Publicador connect flow.',
    );

    const nextQuery = { ...route.query };
    delete nextQuery.token;

    await router.replace({ query: nextQuery });
  },
  { immediate: true },
);

function getHealthTone(status: HealthState['status']) {
  if (status === 'success') return 'text-success-400';
  if (status === 'error') return 'text-error-400';
  return 'text-ui-text-muted';
}

async function runGranHealth() {
  const gran = integrations.value.granPublicador;
  const healthUrl = getGranPublicadorHealthUrl(gran.baseUrl);

  if (!healthUrl || !gran.bearerToken.trim()) {
    healthStates.gran.status = 'error';
    healthStates.gran.message = t(
      'videoEditor.settings.integrationHealthMissingConfig',
      'Set base URL and bearer token first.',
    );
    return;
  }

  healthStates.gran.loading = true;
  healthStates.gran.status = 'idle';
  healthStates.gran.message = '';

  try {
    const result = await runExternalHealthCheck({
      url: healthUrl,
      bearerToken: gran.bearerToken,
    });
    healthStates.gran.status = 'success';
    healthStates.gran.message = `${t('videoEditor.settings.integrationHealthOk', 'OK')} (${result.status})`;
  } catch (error: unknown) {
    healthStates.gran.status = 'error';
    healthStates.gran.message = error instanceof Error ? error.message : 'Health check failed';
  } finally {
    healthStates.gran.loading = false;
  }
}

async function runServiceHealth(kind: 'files' | 'stt') {
  const resolved = resolveExternalServiceConfig({
    service: kind,
    integrations: integrations.value,
  });
  const state = healthStates[kind];

  if (!resolved) {
    state.status = 'error';
    state.message = t(
      'videoEditor.settings.integrationHealthUnavailable',
      'No active integration is configured for this service.',
    );
    return;
  }

  state.loading = true;
  state.status = 'idle';
  state.message = '';

  try {
    const result = await runExternalHealthCheck({
      url: resolved.healthUrl,
      bearerToken: resolved.bearerToken,
    });
    state.status = 'success';
    state.message = `${t('videoEditor.settings.integrationHealthOk', 'OK')} (${result.status})`;
  } catch (error: unknown) {
    state.status = 'error';
    state.message = error instanceof Error ? error.message : 'Health check failed';
  } finally {
    state.loading = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userIntegrations', 'Integrations') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="rounded-lg border border-ui-border p-4 flex flex-col gap-4">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="text-sm font-medium text-ui-text">
            Gran Publicador
          </div>
          <div class="text-xs text-ui-text-muted mt-1">
            {{
              t(
                'videoEditor.settings.granIntegrationHint',
                'Connect via Gran Publicador connect flow or set token manually for the shared external API.',
              )
            }}
          </div>
        </div>
        <label class="flex items-center gap-2 shrink-0 cursor-pointer">
          <UCheckbox v-model="workspaceStore.userSettings.integrations.granPublicador.enabled" />
          <span class="text-sm text-ui-text">
            {{ t('common.enabled', 'Enabled') }}
          </span>
        </label>
      </div>

      <UFormField :label="t('videoEditor.settings.integrationBaseUrl', 'Base URL')">
        <UInput
          v-model="workspaceStore.userSettings.integrations.granPublicador.baseUrl"
          class="w-full"
          placeholder="https://your-gran-instance.com"
        />
      </UFormField>

      <UFormField :label="t('videoEditor.settings.integrationConnectName', 'Connect app name')">
        <UInput
          v-model="workspaceStore.userSettings.integrations.granPublicador.connectName"
          class="w-full"
          placeholder="Gran Video Editor"
        />
      </UFormField>

      <UFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
        <UInput
          v-model="workspaceStore.userSettings.integrations.granPublicador.bearerToken"
          class="w-full"
          type="password"
          autocomplete="off"
          placeholder="gp_token_..."
        />
      </UFormField>

      <div class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="solid"
          :disabled="!granConnectUrl"
          @click="startGranConnect"
        >
          {{ t('videoEditor.settings.integrationConnect', 'Connect') }}
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          :loading="healthStates.gran.loading"
          @click="runGranHealth"
        >
          {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
        </UButton>
        <UButton color="neutral" variant="ghost" @click="disconnectGran">
          {{ t('videoEditor.settings.integrationDisconnect', 'Disconnect') }}
        </UButton>
      </div>

      <div class="text-xs" :class="getHealthTone(healthStates.gran.status)">
        {{ healthStates.gran.message || t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check') }}
      </div>
    </div>

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
                'Manual file API can work standalone or override Gran Publicador for file access.',
              )
            }}
          </div>
        </div>
        <div class="text-xs text-ui-text-muted shrink-0">
          {{ t('videoEditor.settings.integrationActiveSource', 'Active source') }}: {{ filesSourceLabel }}
        </div>
      </div>

      <label class="flex items-center gap-3 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.integrations.manualFilesApi.enabled" />
        <span class="text-sm text-ui-text">{{ t('common.enabled', 'Enabled') }}</span>
      </label>

      <label class="flex items-center gap-3 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.integrations.manualFilesApi.overrideGran" />
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.integrationOverrideGran', 'Override Gran Publicador for this service') }}
        </span>
      </label>

      <UFormField :label="t('videoEditor.settings.integrationBaseUrl', 'Base URL')">
        <UInput
          v-model="workspaceStore.userSettings.integrations.manualFilesApi.baseUrl"
          class="w-full"
          placeholder="https://api.example.com/api/v1/external/vfs"
        />
      </UFormField>

      <UFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
        <UInput
          v-model="workspaceStore.userSettings.integrations.manualFilesApi.bearerToken"
          class="w-full"
          type="password"
          autocomplete="off"
          placeholder="Bearer token"
        />
      </UFormField>

      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="soft"
          :loading="healthStates.files.loading"
          @click="runServiceHealth('files')"
        >
          {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
        </UButton>
      </div>

      <div class="text-xs" :class="getHealthTone(healthStates.files.status)">
        {{ healthStates.files.message || t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check') }}
      </div>
    </div>

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
                'Manual STT API can work standalone or override Gran Publicador for speech recognition.',
              )
            }}
          </div>
        </div>
        <div class="text-xs text-ui-text-muted shrink-0">
          {{ t('videoEditor.settings.integrationActiveSource', 'Active source') }}: {{ sttSourceLabel }}
        </div>
      </div>

      <label class="flex items-center gap-3 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.integrations.manualSttApi.enabled" />
        <span class="text-sm text-ui-text">{{ t('common.enabled', 'Enabled') }}</span>
      </label>

      <label class="flex items-center gap-3 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.integrations.manualSttApi.overrideGran" />
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.integrationOverrideGran', 'Override Gran Publicador for this service') }}
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

      <div class="flex flex-wrap gap-2">
        <UButton
          color="neutral"
          variant="soft"
          :loading="healthStates.stt.loading"
          @click="runServiceHealth('stt')"
        >
          {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
        </UButton>
      </div>

      <div class="text-xs" :class="getHealthTone(healthStates.stt.status)">
        {{ healthStates.stt.message || t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check') }}
      </div>
    </div>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
