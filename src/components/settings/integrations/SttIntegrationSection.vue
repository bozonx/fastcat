<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

import { runModelDownloadTask } from '~/utils/transcription/model-download-task';
const log = createDevLogger('SttIntegrationSection');

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const backgroundTasksStore = useBackgroundTasksStore();

const sttMode = computed({
  get: () => {
    if (workspaceStore.userSettings.integrations.stt.provider === 'local') return 'local';
    return 'fastcat';
  },
  set: (val: 'fastcat' | 'local') => {
    const integrations = workspaceStore.userSettings.integrations;
    if (val === 'local') {
      integrations.stt.provider = 'local';
    } else {
      if (integrations.stt.provider === 'local') {
        integrations.stt.provider = '';
      }
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

const currentModel = computed(() => workspaceStore.userSettings.integrations.stt.localModel);

const activeDownloadTask = computed(() => {
  const model = currentModel.value;
  return backgroundTasksStore.activeTasks.find(
    (task) => task.type === 'model-download' && (task.resourceId === model || task.title === model),
  );
});

const isDownloading = computed(() => !!activeDownloadTask.value);

async function startDownload() {
  if (!workspaceStore.workspaceHandle || isDownloading.value) return;
  try {
    await runModelDownloadTask({
      workspaceHandle: workspaceStore.workspaceHandle,
      modelName: workspaceStore.userSettings.integrations.stt.localModel,
      title: t('videoEditor.backgroundTasks.modelDownloadTitle'),
      description: t('videoEditor.backgroundTasks.modelDownloadDescription', {
        model: workspaceStore.userSettings.integrations.stt.localModel,
      }),
    });
  } catch (e) {
    log.error(e);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 border border-ui-border rounded-lg p-4">
    <div class="flex flex-col gap-1">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.sttTranscriptionSettings') }}
      </div>
      <div class="text-xs text-ui-text-muted">
        {{ t('videoEditor.settings.sttTranscriptionDescription') }}
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
        {{ t('videoEditor.settings.sttFastcat') }}
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
        {{ t('videoEditor.settings.sttLocal') }}
      </button>
    </div>

    <!-- Local STT Form -->
    <div
      v-if="sttMode === 'local'"
      class="flex flex-col gap-4 border border-ui-border rounded-lg p-4 bg-ui-bg-muted/30"
    >
      <div class="flex flex-col gap-4">
        <UiFormField :label="t('videoEditor.settings.sttLocalModel')">
          <UiSelect
            v-model="workspaceStore.userSettings.integrations.stt.localModel"
            :items="[
              { label: 'Whisper Tiny (Multilingual)', value: 'Xenova/whisper-tiny' },
              { label: 'Whisper Base (Multilingual)', value: 'Xenova/whisper-base' },
              { label: 'Whisper Small (Multilingual)', value: 'Xenova/whisper-small' },
              { label: 'Whisper Medium (Multilingual)', value: 'Xenova/whisper-medium' },
              { label: 'Whisper Large v3 (Multilingual)', value: 'Xenova/whisper-large-v3' },
            ]"
            full-width
          />
        </UiFormField>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-xs text-ui-text-muted">
              {{
                workspaceStore.isSttModelDownloaded
                  ? t('videoEditor.settings.sttModelDownloaded')
                  : t('videoEditor.settings.sttModelNotDownloaded')
              }}
            </div>
            <UButton
              v-if="!workspaceStore.isSttModelDownloaded && !isDownloading"
              size="sm"
              color="primary"
              variant="soft"
              :loading="isDownloading"
              @click="startDownload"
            >
              {{ t('videoEditor.settings.sttDownloadModel') }}
            </UButton>
            <div
              v-else-if="workspaceStore.isSttModelDownloaded"
              class="text-xs text-success-400 flex items-center gap-1"
            >
              <UIcon name="i-heroicons-check-circle" class="w-4 h-4" />
              {{ t('videoEditor.settings.sttModelReady') }}
            </div>
          </div>

          <div v-if="isDownloading" class="flex flex-col gap-2 mt-2">
            <div class="flex items-center gap-1 text-xs text-ui-text-muted">
              <UIcon name="i-heroicons-arrow-down-tray" class="w-3.5 h-3.5 animate-pulse" />
              <span>{{ t('videoEditor.settings.sttModelDownloadingInBackground') }}</span>
            </div>
            <div class="text-[10px] text-ui-text-muted leading-tight">
              {{ t('videoEditor.settings.sttModelDownloadHint') }}
            </div>
            <div
              class="flex justify-between text-[10px] text-ui-text-muted tracking-wider"
            >
              <span>{{ Math.round((activeDownloadTask?.progress || 0) * 100) }}%</span>
            </div>
            <UProgress
              :value="(activeDownloadTask?.progress || 0) * 100"
              size="sm"
              color="primary"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Shared STT Settings -->
    <div class="flex flex-col gap-4 pl-1">
      <div v-if="sttMode !== 'local'" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UiFormField :label="t('videoEditor.settings.integrationSttProvider')">
          <UiTextInput
            v-model="workspaceStore.userSettings.integrations.stt.provider"
            full-width
            placeholder="assemblyai"
          />
        </UiFormField>

        <UiFormField :label="t('videoEditor.settings.integrationSttModels')">
          <UiTextInput
            v-model="sttModelsText"
            full-width
            placeholder="universal-3-pro, universal-2"
          />
        </UiFormField>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
        <UiFormField
          :label="t('videoEditor.fileManager.audio.transcriptionLanguage')"
          :description="t('videoEditor.fileManager.audio.transcriptionLanguageHint')"
        >
          <UiTextInput
            v-model="workspaceStore.userSettings.integrations.stt.language"
            full-width
            placeholder="en"
          />
        </UiFormField>
      </div>
    </div>
  </div>
</template>
