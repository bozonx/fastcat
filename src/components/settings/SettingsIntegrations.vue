<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings';
import { FASTCAT_PUBLICADOR_APP_NAME } from '~/utils/constants';
import {
  getFastCatPublicadorConnectUrl,
  getFastCatPublicadorHealthUrl,
  resolveExternalIntegrations,
  resolveFastCatConnectScopes,
  resolveExternalServiceConfig,
  runExternalHealthCheck,
} from '~/utils/external-integrations';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

interface HealthState {
  loading: boolean;
  status: 'idle' | 'success' | 'error';
  message: string;
}

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const runtimeConfig = useRuntimeConfig();

const isResetConfirmOpen = ref(false);

const sttModelsText = computed({
  get: () => workspaceStore.userSettings.integrations.stt.models.join(', '),
  set: (value: string) => {
    workspaceStore.userSettings.integrations.stt.models = value
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
  },
});

const fastcatPublicadorBaseUrl = computed(() => {
  const value = runtimeConfig.public.fastcatPublicadorBaseUrl;
  return typeof value === 'string' ? value.trim() : '';
});

const healthStates = reactive<Record<'fastcat' | 'files' | 'stt', HealthState>>({
  fastcat: { loading: false, status: 'idle', message: '' },
  files: { loading: false, status: 'idle', message: '' },
  stt: { loading: false, status: 'idle', message: '' },
});

const integrations = computed(() => workspaceStore.userSettings.integrations);
const resolvedServices = computed(() =>
  resolveExternalIntegrations({
    userSettings: workspaceStore.userSettings,
    fastcatPublicadorBaseUrl: fastcatPublicadorBaseUrl.value,
  }),
);

const redirectUri = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${route.path}`;
});

const fastcatConnectUrl = computed(() =>
  getFastCatPublicadorConnectUrl({
    baseUrl: fastcatPublicadorBaseUrl.value,
    name: FASTCAT_PUBLICADOR_APP_NAME,
    redirectUri: redirectUri.value,
    scopes: resolveFastCatConnectScopes({ integrations: integrations.value }),
  }),
);

const fastcatConnectScopesLabel = computed(() =>
  resolveFastCatConnectScopes({ integrations: integrations.value }).join(', '),
);

const filesSourceLabel = computed(() => {
  const resolved = resolvedServices.value.files;
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not configured');
  return resolved.source === 'fastcat_publicador'
    ? t('videoEditor.settings.integrationSourceFastCat', 'FastCat Publicador')
    : t('videoEditor.settings.integrationSourceManual', 'Manual API');
});

const sttSourceLabel = computed(() => {
  const resolved = resolvedServices.value.stt;
  if (!resolved) return t('videoEditor.settings.integrationInactive', 'Not configured');
  return resolved.source === 'fastcat_publicador'
    ? t('videoEditor.settings.integrationSourceFastCat', 'FastCat Publicador')
    : t('videoEditor.settings.integrationSourceManual', 'Manual API');
});

function resetDefaults() {
  workspaceStore.userSettings.integrations = {
    fastcatPublicador: { ...DEFAULT_USER_SETTINGS.integrations.fastcatPublicador },
    manualFilesApi: { ...DEFAULT_USER_SETTINGS.integrations.manualFilesApi },
    manualSttApi: { ...DEFAULT_USER_SETTINGS.integrations.manualSttApi },
    stt: {
      ...DEFAULT_USER_SETTINGS.integrations.stt,
      models: [...DEFAULT_USER_SETTINGS.integrations.stt.models],
    },
  };

  for (const state of Object.values(healthStates)) {
    state.loading = false;
    state.status = 'idle';
    state.message = '';
  }

  isResetConfirmOpen.value = false;
}

function disconnectFastCat() {
  workspaceStore.userSettings.integrations.fastcatPublicador.enabled = false;
  workspaceStore.userSettings.integrations.fastcatPublicador.bearerToken = '';
  healthStates.fastcat.status = 'idle';
  healthStates.fastcat.message = '';
}

function startFastCatConnect() {
  if (!fastcatConnectUrl.value) return;
  window.location.assign(fastcatConnectUrl.value);
}

watch(
  () => route.query.token,
  async (token) => {
    if (typeof token !== 'string' || token.trim().length === 0) return;

    workspaceStore.userSettings.integrations.fastcatPublicador.bearerToken = token.trim();
    workspaceStore.userSettings.integrations.fastcatPublicador.enabled = true;
    healthStates.fastcat.status = 'success';
    healthStates.fastcat.message = t(
      'videoEditor.settings.integrationTokenReceived',
      'Token received from FastCat Publicador connect flow.',
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

async function runFastCatHealth() {
  const fastcat = integrations.value.fastcatPublicador;
  const healthUrl = getFastCatPublicadorHealthUrl(fastcatPublicadorBaseUrl.value);

  if (!healthUrl || !fastcat.bearerToken.trim()) {
    healthStates.fastcat.status = 'error';
    healthStates.fastcat.message = t(
      'videoEditor.settings.integrationHealthMissingConfig',
      'Set FastCat base URL in env and bearer token first.',
    );
    return;
  }

  healthStates.fastcat.loading = true;
  healthStates.fastcat.status = 'idle';
  healthStates.fastcat.message = '';

  try {
    const result = await runExternalHealthCheck({
      url: healthUrl,
      bearerToken: fastcat.bearerToken,
    });
    healthStates.fastcat.status = 'success';
    healthStates.fastcat.message = `${t('videoEditor.settings.integrationHealthOk', 'OK')} (${result.status})`;
  } catch (error: unknown) {
    healthStates.fastcat.status = 'error';
    healthStates.fastcat.message = error instanceof Error ? error.message : 'Health check failed';
  } finally {
    healthStates.fastcat.loading = false;
  }
}

async function runServiceHealth(kind: 'files' | 'stt') {
  const resolved = resolveExternalServiceConfig({
    service: kind,
    integrations: integrations.value,
    fastcatPublicadorBaseUrl: fastcatPublicadorBaseUrl.value,
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
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="
        t('videoEditor.settings.resetIntegrationsSettingsConfirmTitle', 'Reset integrations?')
      "
      :description="
        t(
          'videoEditor.settings.resetIntegrationsSettingsConfirmDesc',
          'This will restore all integration settings to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userIntegrations', 'Integrations') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="rounded-lg border border-ui-border p-4 flex flex-col gap-4">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="text-sm font-medium text-ui-text">FastCat Publicador</div>
          <div class="text-xs text-ui-text-muted mt-1">
            {{
              t(
                'videoEditor.settings.fastcatIntegrationHint',
                'Connect via FastCat Publicador connect flow using the global FASTCAT_PUBLICADOR_BASE_URL or set token manually for the external API.',
              )
            }}
          </div>
        </div>
        <label class="flex items-center gap-2 shrink-0 cursor-pointer">
          <UCheckbox v-model="workspaceStore.userSettings.integrations.fastcatPublicador.enabled" />
          <span class="text-sm text-ui-text">
            {{ t('common.enabled', 'Enabled') }}
          </span>
        </label>
      </div>

      <div class="text-xs text-ui-text-muted">
        FASTCAT_PUBLICADOR_BASE_URL: {{ fastcatPublicadorBaseUrl || '—' }}
      </div>

      <div class="text-xs text-ui-text-muted">
        {{ t('videoEditor.settings.integrationScopes', 'Requested scopes') }}:
        {{ fastcatConnectScopesLabel }}
      </div>

      <div class="text-xs text-ui-text-muted">
        {{ t('videoEditor.settings.integrationConnectName', 'Connect app name') }}:
        {{ FASTCAT_PUBLICADOR_APP_NAME }}
      </div>

      <UFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
        <UInput
          v-model="workspaceStore.userSettings.integrations.fastcatPublicador.bearerToken"
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
          :disabled="!fastcatConnectUrl"
          @click="startFastCatConnect"
        >
          {{ t('videoEditor.settings.integrationAutoConnect', 'Auto connect') }}
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          :loading="healthStates.fastcat.loading"
          @click="runFastCatHealth"
        >
          {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
        </UButton>
        <UButton color="neutral" variant="ghost" @click="disconnectFastCat">
          {{ t('videoEditor.settings.integrationDisconnect', 'Disconnect') }}
        </UButton>
      </div>

      <div class="text-xs" :class="getHealthTone(healthStates.fastcat.status)">
        {{
          healthStates.fastcat.message ||
          t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check')
        }}
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
        <UCheckbox v-model="workspaceStore.userSettings.integrations.manualFilesApi.overrideFastCat" />
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
        {{
          healthStates.files.message ||
          t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check')
        }}
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
        {{
          healthStates.stt.message ||
          t('videoEditor.settings.integrationStatusWaiting', 'Waiting for check')
        }}
      </div>
    </div>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .fastcat/user.settings.json') }}
    </div>
  </div>
</template>
