<script setup lang="ts">
import { computed, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';

import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import { DEFAULT_APP_SETTINGS } from '~/utils/settings/defaults';
const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isClearWorkspaceVardataConfirmOpen = ref(false);

const isDesktopTauri = computed(() => workspaceStore.workspaceProviderId === 'tauri');
const isBrowserWorkspaceMode = computed(() => workspaceStore.workspaceProviderId === 'web');
const contentRootPath = computed({
  get: () => workspaceStore.appSettings.paths.contentRootPath,
  set: (v: string) => {
    workspaceStore.appSettings.paths.contentRootPath = v.trim();
  },
});

const dataRootPath = computed({
  get: () => workspaceStore.appSettings.paths.dataRootPath,
  set: (v: string) => {
    workspaceStore.appSettings.paths.dataRootPath = v.trim();
  },
});

const tempRootPath = computed({
  get: () => workspaceStore.appSettings.paths.tempRootPath,
  set: (v: string) => {
    workspaceStore.appSettings.paths.tempRootPath = v.trim();
  },
});

const proxiesRootPath = computed({
  get: () => workspaceStore.appSettings.paths.proxiesRootPath,
  set: (v: string) => {
    workspaceStore.appSettings.paths.proxiesRootPath = v.trim();
  },
});

const ephemeralTmpRootPath = computed({
  get: () => workspaceStore.appSettings.paths.ephemeralTmpRootPath,
  set: (v: string) => {
    workspaceStore.appSettings.paths.ephemeralTmpRootPath = v.trim();
  },
});

async function pickDesktopPath(target: 'content' | 'data' | 'temp' | 'proxies' | 'ephemeralTmp') {
  if (!isDesktopTauri.value) return;

  const selected = await open({
    directory: true,
    multiple: false,
  });

  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return;

  if (target === 'content') {
    contentRootPath.value = path;
    return;
  }

  if (target === 'data') {
    dataRootPath.value = path;
    return;
  }

  if (target === 'temp') {
    tempRootPath.value = path;
    return;
  }

  if (target === 'proxies') {
    proxiesRootPath.value = path;
    return;
  }

  ephemeralTmpRootPath.value = path;
}

async function confirmClearWorkspaceVardata() {
  isClearWorkspaceVardataConfirmOpen.value = false;
  await workspaceStore.clearVardata();
}

function resetPathDefaults() {
  workspaceStore.appSettings.paths.placementMode = DEFAULT_APP_SETTINGS.paths.placementMode;
  workspaceStore.appSettings.paths.contentRootPath = DEFAULT_APP_SETTINGS.paths.contentRootPath;
  workspaceStore.appSettings.paths.dataRootPath = DEFAULT_APP_SETTINGS.paths.dataRootPath;
  workspaceStore.appSettings.paths.tempRootPath = DEFAULT_APP_SETTINGS.paths.tempRootPath;
  workspaceStore.appSettings.paths.proxiesRootPath = DEFAULT_APP_SETTINGS.paths.proxiesRootPath;
  workspaceStore.appSettings.paths.ephemeralTmpRootPath =
    DEFAULT_APP_SETTINGS.paths.ephemeralTmpRootPath;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.workspaceStorage') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetPathDefaults">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <div v-if="isDesktopTauri" class="flex flex-col gap-6">
      <!-- 1. Папка общих файлов (common) -->
      <UiFormField
        v-if="workspaceStore.userSettings.experimentalFeatures"
        :label="t('videoEditor.settings.commonFilesFolder')"
        :help="t('videoEditor.settings.commonFilesFolderHelp')"
      >
        <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            <UiTextInput v-model="contentRootPath" full-width />
            <UButton
              color="neutral"
              variant="soft"
              icon="i-heroicons-folder-open"
              @click="pickDesktopPath('content')"
            />
          </div>
          <div class="text-xs text-ui-text-muted mt-0.5">
            {{ t('videoEditor.settings.resolvedPathLabel') }}
            <code
              class="bg-ui-bg-elevated/40 px-1 py-0.5 rounded truncate inline-block max-w-full align-bottom"
              >{{ workspaceStore.resolvedStorageTopology.commonRoot }}</code
            >
          </div>
        </div>
      </UiFormField>

      <!-- 2. Папка проектов по умолчанию -->
      <UiFormField
        :label="t('videoEditor.settings.defaultProjectsFolder')"
        :help="t('videoEditor.settings.defaultProjectsFolderHelp')"
      >
        <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            <UiTextInput v-model="dataRootPath" full-width />
            <UButton
              color="neutral"
              variant="soft"
              icon="i-heroicons-folder-open"
              @click="pickDesktopPath('data')"
            />
          </div>
          <div class="text-xs text-ui-text-muted mt-0.5">
            {{ t('videoEditor.settings.resolvedPathLabel') }}
            <code
              class="bg-ui-bg-elevated/40 px-1 py-0.5 rounded truncate inline-block max-w-full align-bottom"
              >{{ workspaceStore.resolvedStorageTopology.projectsRoot }}</code
            >
          </div>
        </div>
      </UiFormField>

      <!-- 3. Папка для прокси-файлов -->
      <UiFormField
        :label="t('videoEditor.settings.proxiesFolder')"
        :help="t('videoEditor.settings.proxiesFolderHelp')"
      >
        <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            <UiTextInput v-model="proxiesRootPath" full-width />
            <UButton
              color="neutral"
              variant="soft"
              icon="i-heroicons-folder-open"
              @click="pickDesktopPath('proxies')"
            />
          </div>
          <div class="text-xs text-ui-text-muted mt-0.5">
            {{ t('videoEditor.settings.resolvedPathLabel') }}
            <code
              class="bg-ui-bg-elevated/40 px-1 py-0.5 rounded truncate inline-block max-w-full align-bottom"
              >{{ workspaceStore.resolvedStorageTopology.proxiesRoot }}</code
            >
          </div>
        </div>
      </UiFormField>

      <!-- Информационный блок о системных путях и кэше -->
      <div class="p-4 rounded-xl border border-ui-border bg-ui-bg-elevated/20 flex flex-col gap-3">
        <div class="text-xs font-bold text-ui-text-muted uppercase tracking-wider">
          {{ t('videoEditor.settings.systemPathsTitle') }}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div class="flex flex-col gap-1">
            <span class="text-ui-text-muted font-medium">{{
              t('videoEditor.settings.cacheFolder')
            }}</span>
            <code class="bg-ui-bg-elevated/40 px-1.5 py-1 rounded truncate block">{{
              workspaceStore.resolvedStorageTopology.tempRoot
            }}</code>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-ui-text-muted font-medium">{{
              t('videoEditor.settings.tempFolder')
            }}</span>
            <code class="bg-ui-bg-elevated/40 px-1.5 py-1 rounded truncate block">{{
              workspaceStore.resolvedStorageTopology.ephemeralTmpRoot
            }}</code>
          </div>
          <div v-if="workspaceStore.tauriAppPaths" class="flex flex-col gap-1 md:col-span-2">
            <span class="text-ui-text-muted font-medium">{{
              t('videoEditor.settings.appSettingsFolder')
            }}</span>
            <code class="bg-ui-bg-elevated/40 px-1.5 py-1 rounded truncate block">{{
              workspaceStore.tauriAppPaths.configDir
            }}</code>
          </div>
        </div>
      </div>
    </div>

    <UiConfirmModal
      v-model:open="isClearWorkspaceVardataConfirmOpen"
      :title="t('videoEditor.settings.clearTempWorkspaceTitle')"
      :description="
        t(
          'videoEditor.settings.clearTempWorkspaceDescription',
          'Nothing will happen to your important project files. Only auto-generated and temporary data will be removed: proxy files, thumbnails, waveforms, cache, and temporary import/export files.',
        )
      "
      :confirm-text="t('videoEditor.settings.clearTempWorkspaceConfirm')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearWorkspaceVardata"
    />

    <div
      v-if="isBrowserWorkspaceMode || isDesktopTauri"
      class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border"
    >
      <div class="flex flex-col gap-1 min-w-0">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.clearTempWorkspace') }}
        </div>
        <div class="text-xs text-ui-text-muted">
          {{
            t(
              'videoEditor.settings.clearTempWorkspaceHint',
              'Nothing will happen to your important project files. Only auto-generated and temporary data will be deleted: proxy files, thumbnails, waveforms, cache, and temporary import/export files.',
            )
          }}
        </div>
      </div>

      <UButton
        color="warning"
        variant="soft"
        icon="i-heroicons-trash"
        :label="t('videoEditor.settings.clearTempWorkspaceAction')"
        @click="isClearWorkspaceVardataConfirmOpen = true"
      />
    </div>
  </div>
</template>
