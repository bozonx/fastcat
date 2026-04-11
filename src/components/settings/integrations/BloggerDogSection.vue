<script setup lang="ts">
import { reactive, computed, onMounted } from 'vue';
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
  return workspaceStore.userSettings?.integrations?.fastcatPublicador;
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
  return `${window.location.origin}${route.path}?target=bloggerdog`;
});

const fastcatConnectUrl = computed(() => {
  if (!bloggerDogUiUrl.value) return '';
  return getFastCatPublicadorConnectUrl({
    uiUrl: bloggerDogUiUrl.value,
    name: FASTCAT_PUBLICADOR_APP_NAME,
    redirectUri: redirectUri.value,
    scopes: resolveFastCatConnectScopes({ 
      integrations: workspaceStore.userSettings.integrations,
      includeStt: false,
    }),
    state: 'bloggerdog',
  });
});

const fastcatConnectScopesLabel = computed(() =>
  resolveFastCatConnectScopes({ 
    integrations: workspaceStore.userSettings.integrations,
    includeStt: false,
  }).join(', '),
);

function disconnectFastCat() {
  workspaceStore.userSettings.integrations.fastcatPublicador.enabled = false;
  workspaceStore.userSettings.integrations.fastcatPublicador.bearerToken = '';
  healthState.status = 'idle';
  healthState.message = '';
}

function startFastCatConnect() {
  if (!fastcatConnectUrl.value) return;
  window.open(fastcatConnectUrl.value, '_blank');
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
    healthState.message = `${t('videoEditor.settings.integrationHealthOk')} (${result.status})`;
  } catch (error: unknown) {
    healthState.status = 'error';
    healthState.message = error instanceof Error ? error.message : 'Health check failed';
  } finally {
    healthState.loading = false;
  }
}

onMounted(() => {
  if (fastcat.value?.bearerToken) {
    runHealth();
  }
});

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
        <div class="mt-2">
          <a
            v-if="bloggerDogUiUrl"
            :href="bloggerDogUiUrl"
            target="_blank"
            class="text-xs text-primary-400 hover:underline inline-flex items-center gap-1"
          >
            {{ t('videoEditor.settings.integrationManualLink') }}
            <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-3 w-3" />
          </a>
        </div>
      </div>

      <div class="flex flex-col items-end gap-2 shrink-0">
        <div v-if="fastcat?.bearerToken" class="flex items-center gap-1">
          <div
            class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
            :class="[
              healthState.status === 'success'
                ? 'bg-success-500/10 text-success-400'
                : healthState.status === 'error'
                  ? 'bg-error-500/10 text-error-400'
                  : 'bg-ui-bg-muted/50 text-ui-text-muted',
            ]"
          >
            <UIcon
              v-if="healthState.status === 'success'"
              name="i-heroicons-check-circle"
              class="h-4 w-4"
            />
            <UIcon
              v-else-if="healthState.status === 'error'"
              name="i-heroicons-exclamation-circle"
              class="h-4 w-4"
            />
            <span v-if="healthState.loading">
              {{ t('common.loading') }}
            </span>
            <span v-else-if="healthState.status === 'success'">
              {{ t('videoEditor.settings.integrationHealthOk') }}
            </span>
            <span v-else-if="healthState.status === 'error'">
              {{ t('common.error') }}
            </span>
            <span v-else>
              {{ t('videoEditor.settings.integrationStatusWaiting') }}
            </span>
          </div>

          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :loading="healthState.loading"
            icon="i-heroicons-arrow-path"
            @click="runHealth"
          />
        </div>

        <UButton
          v-if="fastcat?.bearerToken"
          color="error"
          variant="ghost"
          size="xs"
          @click="disconnectFastCat"
        >
          {{ t('videoEditor.settings.integrationBreakConnection') }}
        </UButton>
      </div>
    </div>

    <!-- NOT CONNECTED STATE -->
    <div v-if="!fastcat?.bearerToken" class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <UButton
          color="primary"
          variant="solid"
          :disabled="!bloggerDogUiUrl"
          @click="startFastCatConnect"
        >
          {{ t('videoEditor.settings.bloggerDogConnectAction') }}
        </UButton>
      </div>
    </div>

    <!-- ERRORS -->
    <div
      v-if="healthState.status === 'error'"
      class="text-xs"
      :class="getHealthTone(healthState.status)"
    >
      {{ healthState.message }}
    </div>
  </div>
</template>
