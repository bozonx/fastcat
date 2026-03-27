<script setup lang="ts">
import { reactive, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

import { FASTCAT_PUBLICADOR_APP_NAME } from '~/utils/constants';
import {
  getFastCatPublicadorConnectUrl,
  getFastCatPublicadorHealthUrl,
  resolveFastCatConnectScopes,
  runExternalHealthCheck,
} from '~/utils/external-integrations';

import type { FastCatPublicadorIntegrationSettings } from '~/utils/settings';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const runtimeConfig = useRuntimeConfig();

const healthState = reactive({
  loading: false,
  status: 'idle' as 'idle' | 'success' | 'error',
  message: '',
});

const fastcat = computed<FastCatPublicadorIntegrationSettings | undefined>(() => {
  const settings = workspaceStore.userSettings?.integrations?.fastcatPublicador;
  const envToken = runtimeConfig.public.bloggerDogToken;

  if (settings && !settings.bearerToken && typeof envToken === 'string' && envToken.trim()) {
    return {
      enabled: settings.enabled,
      bearerToken: envToken.trim(),
    };
  }
  return settings;
});

const bloggerDogApiUrl = computed(() => {
  const value = runtimeConfig.public.bloggerDogApiUrl;
  return typeof value === 'string' ? value.trim() : '';
});

const bloggerDogUiUrl = computed(() => {
  const value = runtimeConfig.public.bloggerDogUiUrl;
  return typeof value === 'string' ? value.trim() : '';
});

const redirectUri = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${route.path}`;
});

const fastcatConnectUrl = computed(() => {
  if (!bloggerDogUiUrl.value) return '';
  return getFastCatPublicadorConnectUrl({
    uiUrl: bloggerDogUiUrl.value,
    name: FASTCAT_PUBLICADOR_APP_NAME,
    redirectUri: redirectUri.value,
    scopes: resolveFastCatConnectScopes({ integrations: workspaceStore.userSettings.integrations }),
  });
});

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
  const healthUrl = getFastCatPublicadorHealthUrl(bloggerDogApiUrl.value);

  if (!healthUrl || !fastcat.value?.bearerToken?.trim()) {
    healthState.status = 'error';
    healthState.message = t(
      'videoEditor.settings.integrationHealthMissingConfig',
      'BloggerDog API URL or token is missing.',
    );
    return;
  }

  healthState.loading = true;
  healthState.status = 'idle';
  healthState.message = '';

  try {
    const result = await runExternalHealthCheck({
      url: healthUrl,
      bearerToken: fastcat.value?.bearerToken || '',
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
        <div class="text-sm font-medium text-ui-text">BloggerDog</div>
        <div class="text-xs text-ui-text-muted mt-1">
          {{ t('videoEditor.settings.bloggerDogIntegrationHint') }}
        </div>
      </div>
      <div
        v-if="fastcat?.bearerToken"
        class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success-500/10 text-success-400 text-xs font-medium shrink-0"
      >
        <UIcon name="i-heroicons-check-circle" class="h-4 w-4" />
        {{ t('videoEditor.settings.integrationHealthOk', 'Connected') }}
      </div>
    </div>

    <!-- NOT CONNECTED STATE -->
    <div v-if="!fastcat?.bearerToken" class="flex flex-col gap-4 mt-2">
      <div class="flex flex-col gap-1 p-2 rounded bg-ui-bg-muted/50 border border-ui-border/50">
        <div class="text-2xs text-ui-text-muted">
          API URL: <span class="text-ui-text">{{ bloggerDogApiUrl || '—' }}</span>
        </div>
        <div class="text-2xs text-ui-text-muted">
          UI URL: <span class="text-ui-text">{{ bloggerDogUiUrl || '—' }}</span>
        </div>
        <div class="text-2xs text-ui-text-muted mt-1">
          {{ t('videoEditor.settings.integrationScopes', 'Requested scopes') }}:
          {{ fastcatConnectScopesLabel }}
        </div>
      </div>

      <div class="flex items-center gap-3">
        <UButton
          color="primary"
          variant="solid"
          :disabled="!bloggerDogUiUrl"
          @click="startFastCatConnect"
        >
          {{ t('videoEditor.settings.integrationConnectAction', 'Connect') }}
        </UButton>

        <a
          v-if="bloggerDogUiUrl"
          :href="bloggerDogUiUrl"
          target="_blank"
          class="text-xs text-primary-400 hover:underline flex items-center gap-1 ml-auto"
        >
          {{ t('videoEditor.settings.integrationManualLink', 'Open BloggerDog site') }}
          <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-3 w-3" />
        </a>
      </div>
    </div>

    <!-- CONNECTED STATE -->
    <div v-else class="flex flex-col gap-5 mt-2">
      <div class="flex flex-col gap-1.5 p-3 rounded-lg border border-ui-border bg-ui-bg">
        <div class="text-2xs uppercase tracking-wider text-ui-text-muted font-bold">
          {{ t('videoEditor.settings.integrationBaseUrl', 'API URL') }}
        </div>
        <div class="text-sm text-ui-text break-all">
          {{ bloggerDogApiUrl }}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <UButton color="neutral" variant="soft" :loading="healthState.loading" @click="runHealth">
          {{ t('videoEditor.settings.integrationHealthCheck', 'Check health') }}
        </UButton>

        <UButton color="error" variant="ghost" size="sm" @click="disconnectFastCat">
          {{ t('videoEditor.settings.integrationBreakConnection', 'Break connection') }}
        </UButton>
      </div>

      <div
        v-if="healthState.status !== 'idle' || healthState.loading"
        class="text-xs"
        :class="getHealthTone(healthState.status)"
      >
        {{ healthState.message || t('common.loading', 'Loading...') }}
      </div>
    </div>
  </div>
</template>
