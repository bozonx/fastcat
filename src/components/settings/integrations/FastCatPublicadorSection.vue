<script setup lang="ts">
import { reactive, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import { FASTCAT_PUBLICADOR_APP_NAME } from '~/utils/constants';
import {
  getFastCatPublicadorConnectUrl,
  getFastCatPublicadorHealthUrl,
  resolveFastCatConnectScopes,
  runExternalHealthCheck,
} from '~/utils/external-integrations';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
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

const redirectUri = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${route.path}`;
});

const fastcatConnectUrl = computed(() =>
  getFastCatPublicadorConnectUrl({
    baseUrl: fastcatPublicadorBaseUrl.value,
    name: FASTCAT_PUBLICADOR_APP_NAME,
    redirectUri: redirectUri.value,
    scopes: resolveFastCatConnectScopes({ integrations: workspaceStore.userSettings.integrations }),
  }),
);

const fastcatConnectScopesLabel = computed(() =>
  resolveFastCatConnectScopes({ integrations: workspaceStore.userSettings.integrations }).join(
    ', ',
  ),
);

function disconnectFastCat() {
  workspaceStore.userSettings.integrations.fastcatPublicador.enabled = false;
  workspaceStore.userSettings.integrations.fastcatPublicador.bearerToken = '';
  healthState.status = 'idle';
  healthState.message = '';
}

function startFastCatConnect() {
  if (!fastcatConnectUrl.value) return;
  window.location.assign(fastcatConnectUrl.value);
}

async function runHealth() {
  const fastcat = workspaceStore.userSettings.integrations.fastcatPublicador;
  const healthUrl = getFastCatPublicadorHealthUrl(fastcatPublicadorBaseUrl.value);

  if (!healthUrl || !fastcat.bearerToken.trim()) {
    healthState.status = 'error';
    healthState.message = t(
      'videoEditor.settings.integrationHealthMissingConfig',
      'Set FastCat base URL in env and bearer token first.',
    );
    return;
  }

  healthState.loading = true;
  healthState.status = 'idle';
  healthState.message = '';

  try {
    const result = await runExternalHealthCheck({
      url: healthUrl,
      bearerToken: fastcat.bearerToken,
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

    <UiFormField :label="t('videoEditor.settings.integrationBearerToken', 'Bearer token')">
      <UiTextInput
        v-model="workspaceStore.userSettings.integrations.fastcatPublicador.bearerToken"
        full-width
        type="password"
        autocomplete="off"
        placeholder="gp_token_..."
      />
    </UiFormField>

    <div class="flex flex-wrap gap-2">
      <UButton
        color="primary"
        variant="solid"
        :disabled="!fastcatConnectUrl"
        @click="startFastCatConnect"
      >
        {{ t('videoEditor.settings.integrationAutoConnect', 'Auto connect') }}
      </UButton>
      <UButton color="neutral" variant="soft" :loading="healthState.loading" @click="runHealth">
        {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
      </UButton>
      <UButton color="neutral" variant="ghost" @click="disconnectFastCat">
        {{ t('videoEditor.settings.integrationDisconnect', 'Disconnect') }}
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
