<script setup lang="ts">
import { reactive, computed, ref, onMounted, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

import {
  resolveExternalServiceConfig,
  runExternalHealthCheck,
} from '~/utils/external-integrations';
import {
  isModelDownloaded,
  downloadModel,
  type ModelDownloadProgress,
} from '~/utils/transcription/model-storage';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const runtimeConfig = useRuntimeConfig();

const healthState = reactive({
  loading: false,
  status: 'idle' as 'idle' | 'success' | 'error',
  message: '',
});

const sttMode = computed({
  get: () => {
    if (workspaceStore.userSettings.integrations.stt.provider === 'local') return 'local';
    if (workspaceStore.userSettings.integrations.manualSttApi.enabled) return 'custom';
    return 'fastcat';
  },
  set: (val: 'fastcat' | 'custom' | 'local') => {
    const integrations = workspaceStore.userSettings.integrations;
    if (val === 'local') {
      integrations.stt.provider = 'local';
      integrations.manualSttApi.enabled = false;
    } else if (val === 'custom') {
      if (integrations.stt.provider === 'local') {
        integrations.stt.provider = '';
      }
      integrations.manualSttApi.enabled = true;
      integrations.manualSttApi.overrideFastCat = true;
    } else {
      if (integrations.stt.provider === 'local') {
        integrations.stt.provider = '';
      }
      integrations.manualSttApi.enabled = false;
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

const isDownloaded = ref(false);
const downloadState = reactive({
  loading: false,
  progress: 0,
  file: '',
  status: '',
});

async function checkStatus() {
  if (!workspaceStore.workspaceHandle) return;
  isDownloaded.value = await isModelDownloaded(
    workspaceStore.workspaceHandle,
    workspaceStore.userSettings.integrations.stt.localModel,
  );
}

async function startDownload() {
  if (!workspaceStore.workspaceHandle) return;
  downloadState.loading = true;
  try {
    await downloadModel(
      workspaceStore.workspaceHandle,
      workspaceStore.userSettings.integrations.stt.localModel,
      (p: ModelDownloadProgress) => {
        downloadState.progress = p.total > 0 ? (p.loaded / p.total) * 100 : 0;
        downloadState.file = p.file;
        downloadState.status = p.status;
      },
    );
    await checkStatus();
  } catch (e) {
    console.error(e);
  } finally {
    downloadState.loading = false;
  }
}

onMounted(() => {
  checkStatus();
});

watch(
  () => workspaceStore.userSettings.integrations.stt.localModel,
  () => {
    checkStatus();
  },
);
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
          sttMode === 'fastcat'
            ? isFastcatConnected
              ? 'bg-primary-500 text-white shadow-sm'
              : 'bg-error-500 text-white shadow-sm'
            : 'text-ui-text-muted hover:text-ui-text',
        ]"
        class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2"
        @click="sttMode = 'fastcat'"
      >
        <UIcon v-if="!isFastcatConnected" name="i-heroicons-link-slash" class="w-3.5 h-3.5" />
        {{ t('videoEditor.settings.sttFastcat', 'FASTCAT STT') }}
      </button>
      <button
        type="button"
        :class="[
          sttMode === 'custom'
            ? healthState.status === 'error'
              ? 'bg-error-500 text-white shadow-sm'
              : 'bg-primary-500 text-white shadow-sm'
            : 'text-ui-text-muted hover:text-ui-text',
        ]"
        class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
        @click="sttMode = 'custom'"
      >
        {{ t('videoEditor.settings.sttCustom', 'Custom STT') }}
      </button>
      <button
        type="button"
        :class="[
          sttMode === 'local'
            ? 'bg-primary-500 text-white shadow-sm'
            : 'text-ui-text-muted hover:text-ui-text',
        ]"
        class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
        @click="sttMode = 'local'"
      >
        {{ t('videoEditor.settings.sttLocal', 'Local') }}
      </button>
    </div>

    <!-- Local STT Form -->
    <div
      v-if="sttMode === 'local'"
      class="flex flex-col gap-4 border border-ui-border rounded-lg p-4 bg-ui-bg-muted/30"
    >
      <div class="flex flex-col gap-4">
        <UiFormField :label="t('videoEditor.settings.sttLocalModel', 'Whisper Model')">
          <UiSelect
            v-model="workspaceStore.userSettings.integrations.stt.localModel"
            :items="[
              { label: 'Whisper Tiny (Multilingual)', value: 'onnx-community/whisper-tiny' },
              { label: 'Whisper Base (Multilingual)', value: 'onnx-community/whisper-base' },
            ]"
            full-width
          />
        </UiFormField>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-xs text-ui-text-muted">
              {{
                isDownloaded
                  ? t('videoEditor.settings.sttModelDownloaded', 'Model is ready for use')
                  : t('videoEditor.settings.sttModelNotDownloaded', 'Model needs to be downloaded')
              }}
            </div>
            <UButton
              v-if="!isDownloaded || downloadState.loading"
              size="sm"
              color="primary"
              variant="soft"
              :loading="downloadState.loading"
              @click="startDownload"
            >
              {{ t('videoEditor.settings.sttDownloadModel', 'Download model') }}
            </UButton>
            <div v-else class="text-xs text-success-400 flex items-center gap-1">
              <UIcon name="i-heroicons-check-circle" class="w-4 h-4" />
              {{ t('videoEditor.settings.sttModelReady', 'Ready') }}
            </div>
          </div>

          <div v-if="downloadState.loading" class="flex flex-col gap-1 mt-2">
            <div class="flex justify-between text-[10px] text-ui-text-muted uppercase tracking-wider">
              <span>{{ downloadState.status }}: {{ downloadState.file }}</span>
              <span>{{ Math.round(downloadState.progress) }}%</span>
            </div>
            <UProgress :value="downloadState.progress" size="sm" color="primary" />
          </div>
        </div>
      </div>
    </div>

    <!-- Manual STT Form -->
    <div
      v-if="sttMode === 'custom'"
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
    <div v-if="sttMode !== 'local'" class="flex flex-col gap-4 pl-1">
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
