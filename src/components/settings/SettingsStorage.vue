<script setup lang="ts">
import { computed, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';

import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import { DEFAULT_APP_SETTINGS } from '~/utils/settings/defaults';
import type { StoragePlacementMode } from '~/utils/storage-roots';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isClearWorkspaceVardataConfirmOpen = ref(false);

const isDesktopTauri = computed(() => workspaceStore.workspaceProviderId === 'tauri');
const isBrowserWorkspaceMode = computed(() => workspaceStore.workspaceProviderId === 'web');
const isPortableMode = computed(
  () => workspaceStore.appSettings.paths.placementMode === 'portable',
);
const isDesktopSystemMode = computed(() => isDesktopTauri.value && !isPortableMode.value);
const isDesktopPortableMode = computed(() => isDesktopTauri.value && isPortableMode.value);

const placementModeOptions = computed(() => [
  {
    label: t('videoEditor.settings.storageModeSystemDefault'),
    value: 'system-default',
  },
  {
    label: t('videoEditor.settings.storageModePortable'),
    value: 'portable',
  },
]);

const placementMode = computed({
  get: () => workspaceStore.appSettings.paths.placementMode,
  set: (value: StoragePlacementMode) => {
    workspaceStore.appSettings.paths.placementMode = value;
  },
});

const workspaceFolderLabel = computed(() => {
  const handle = workspaceStore.workspaceHandle as
    | (FileSystemDirectoryHandle & { path?: string })
    | null;
  if (!handle) {
    return t('videoEditor.settings.workspaceFolderNotSelected');
  }

  if (typeof handle.path === 'string' && handle.path.trim().length > 0) {
    return handle.path;
  }

  return handle.name;
});

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

async function pickWorkspaceFolder() {
  await workspaceStore.openWorkspace();
}

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

    <UiFormField
      v-if="isDesktopTauri"
      :label="t('videoEditor.settings.storageMode')"
      :help="
        t(
          'videoEditor.settings.storageModeHelp',
          'Choose between OS default folders and portable workspace-local storage.',
        )
      "
    >
      <UiSelect
        v-model="placementMode"
        :items="placementModeOptions"
        value-key="value"
        full-width
      />
    </UiFormField>

    <div
      v-if="isBrowserWorkspaceMode || isDesktopPortableMode"
      class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border"
    >
      <div class="flex flex-col gap-1 min-w-0">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.workspaceFolder') }}
        </div>
        <div class="text-xs text-ui-text-muted break-all">
          {{ workspaceFolderLabel }}
        </div>
      </div>

      <UButton
        color="neutral"
        variant="soft"
        icon="i-heroicons-folder-open"
        :label="t('videoEditor.settings.selectWorkspaceFolder')"
        @click="pickWorkspaceFolder"
      />
    </div>

    <div v-if="isDesktopSystemMode" class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <UiFormField
        :label="t('videoEditor.settings.contentRootPath')"
        :help="
          t(
            'videoEditor.settings.contentRootPathHelp',
            'Projects and common content use this shared parent path on desktop. Leave empty to use the default OS location.',
          )
        "
      >
        <div class="flex gap-2">
          <UiTextInput v-model="ephemeralTmpRootPath" full-width />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('ephemeralTmp')"
          />
        </div>
      </UiFormField>

      <UiFormField
        :label="t('videoEditor.settings.dataRootPath')"
        :help="
          t(
            'videoEditor.settings.dataRootPathHelp',
            'Reserved for future persistent application libraries such as plugins, sticker packs or shared installed assets.',
          )
        "
      >
        <div class="flex gap-2">
          <UiTextInput v-model="dataRootPath" full-width />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('data')"
          />
        </div>
      </UiFormField>

      <UiFormField
        :label="t('videoEditor.settings.tempRootPath')"
        :help="
          t(
            'videoEditor.settings.tempRootPathHelp',
            'Location for rebuildable cache, thumbnails, waveforms and temporary files. Leave empty to use the default OS cache location.',
          )
        "
      >
        <div class="flex gap-2">
          <UiTextInput v-model="tempRootPath" full-width />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('temp')"
          />
        </div>
      </UiFormField>

      <UiFormField
        :label="t('videoEditor.settings.proxiesRootPath')"
        :help="
          t(
            'videoEditor.settings.proxiesRootPathHelp',
            'Generated proxy media can use a dedicated path. Leave empty to use the default application location.',
          )
        "
      >
        <div class="flex gap-2">
          <UiTextInput v-model="proxiesRootPath" full-width />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('proxies')"
          />
        </div>
      </UiFormField>

      <UiFormField
        :label="t('videoEditor.settings.ephemeralTmpRootPath')"
        :help="
          t(
            'videoEditor.settings.ephemeralTmpRootPathHelp',
            'Short-lived temporary job files. Leave empty to use the system temporary directory.',
          )
        "
      >
        <div class="flex gap-2">
          <UInput v-model="ephemeralTmpRootPath" class="w-full" />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('ephemeralTmp')"
          />
        </div>
      </UiFormField>
    </div>

    <div v-if="isDesktopPortableMode" class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <UiFormField
        :label="t('videoEditor.settings.ephemeralTmpRootPath')"
        :help="
          t(
            'videoEditor.settings.portableEphemeralTmpRootPathHelp',
            'Portable mode stores project cache inside workspace. Leave this empty to keep short-lived job files in the system temporary directory.',
          )
        "
      >
        <div class="flex gap-2">
          <UInput v-model="ephemeralTmpRootPath" class="w-full" />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('ephemeralTmp')"
          />
        </div>
      </UiFormField>
    </div>

    <div v-if="isBrowserWorkspaceMode" class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <UiFormField
        :label="t('videoEditor.settings.ephemeralTmpRootPath')"
        :help="
          t(
            'videoEditor.settings.browserEphemeralTmpRootPathHelp',
            'Leave empty to use the runtime temporary location when supported. Browser workspaces always keep rebuildable cache inside the selected workspace folder.',
          )
        "
      >
        <UiTextInput v-model="ephemeralTmpRootPath" full-width />
      </UiFormField>
    </div>

    <div
      v-if="isBrowserWorkspaceMode"
      class="text-xs text-ui-text-muted rounded border border-ui-border p-3"
    >
      {{
        t(
          'videoEditor.settings.storagePathEnvironmentHint',
          'Browser workspace mode stores projects, shared files and rebuildable cache inside the selected workspace folder. Only the workspace folder and ephemeral tmp override are configurable here.',
        )
      }}
    </div>

    <UiConfirmModal
      v-model:open="isClearWorkspaceVardataConfirmOpen"
      :title="t('videoEditor.settings.clearTempWorkspaceTitle')"
      :description="
        t(
          'videoEditor.settings.clearTempWorkspaceDescription',
          'This will delete all generated proxies, thumbnails and cached data in this workspace.',
        )
      "
      :confirm-text="t('videoEditor.settings.clearTempWorkspaceConfirm')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearWorkspaceVardata"
    />

    <div
      v-if="isBrowserWorkspaceMode || isDesktopPortableMode"
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
              'Removes all files from vardata in this workspace',
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
