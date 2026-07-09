<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useStoragePersistence } from '~/composables/useStoragePersistence';
import { formatBytes } from '~/utils/format';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiAlert from '~/components/ui/UiAlert.vue';

import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isClearWorkspaceVardataConfirmOpen = ref(false);

const isDesktopTauri = computed(() => workspaceStore.workspaceProviderId === 'tauri');
const isBrowserWorkspaceMode = computed(() => workspaceStore.workspaceProviderId === 'web');

const {
  isSupported: isStorageApiSupported,
  isPersistSupported,
  isPersisted,
  persistDeclined,
  usageBytes,
  quotaBytes,
  usageRatio,
  isRequesting: isRequestingPersist,
  refresh: refreshStorageEstimate,
  requestPersist,
} = useStoragePersistence();

const usagePercent = computed(() =>
  usageRatio.value == null ? null : Math.round(usageRatio.value * 100),
);
const usageLabel = computed(() => {
  if (usageBytes.value == null) return null;
  const used = formatBytes(usageBytes.value, 1);
  if (!quotaBytes.value) return used;
  return `${used} / ${formatBytes(quotaBytes.value, 1)}`;
});

onMounted(() => {
  if (isBrowserWorkspaceMode.value && isStorageApiSupported) {
    void refreshStorageEstimate();
  }
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

async function pickDesktopPath(target: 'content' | 'data' | 'temp' | 'proxies' | 'ephemeralTmp') {
  if (!isDesktopTauri.value) return;

  const { open } = await import('@tauri-apps/plugin-dialog');
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
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-sm font-medium text-ui-text">
      {{ t('videoEditor.settings.workspaceStorage') }}
    </div>

    <div v-if="isDesktopTauri" class="flex flex-col gap-6">
      <!-- 1. Папка общих файлов (common) -->
      <UiFormField
        v-if="workspaceStore.inDevelopmentFeaturesEnabled"
        :label="t('videoEditor.settings.commonFilesFolder')"
        :help="t('videoEditor.settings.commonFilesFolderHelp')"
      >
        <div class="flex gap-2">
          <UiTextInput
            v-model="contentRootPath"
            full-width
            :placeholder="workspaceStore.resolvedStorageTopology.commonRoot"
          />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('content')"
          />
        </div>
      </UiFormField>

      <!-- 2. Папка проектов по умолчанию -->
      <UiFormField
        :label="t('videoEditor.settings.defaultProjectsFolder')"
        :help="t('videoEditor.settings.defaultProjectsFolderHelp')"
      >
        <div class="flex gap-2">
          <UiTextInput
            v-model="dataRootPath"
            full-width
            :placeholder="workspaceStore.resolvedStorageTopology.projectsRoot"
          />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('data')"
          />
        </div>
      </UiFormField>

      <!-- 3. Папка для прокси-файлов -->
      <UiFormField
        :label="t('videoEditor.settings.proxiesFolder')"
        :help="t('videoEditor.settings.proxiesFolderHelp')"
      >
        <div class="flex gap-2">
          <UiTextInput
            v-model="proxiesRootPath"
            full-width
            :placeholder="workspaceStore.resolvedStorageTopology.proxiesRoot"
          />
          <UButton
            color="neutral"
            variant="soft"
            icon="i-heroicons-folder-open"
            @click="pickDesktopPath('proxies')"
          />
        </div>
      </UiFormField>

      <!-- Информационный блок о системных путях и кэше -->
      <div class="p-4 rounded-xl border border-ui-border bg-ui-bg-elevated/20 flex flex-col gap-3">
        <div class="text-xs font-bold text-ui-text-muted tracking-wider">
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
      :description="t('videoEditor.settings.clearTempWorkspaceDescription')"
      :confirm-text="t('videoEditor.settings.clearTempWorkspaceConfirm')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearWorkspaceVardata"
    />

    <!-- Browser sandbox storage: quota usage + eviction protection -->
    <div
      v-if="isBrowserWorkspaceMode && isStorageApiSupported"
      class="flex flex-col gap-4 p-4 rounded-xl border border-ui-border bg-ui-bg-elevated/20"
    >
      <div class="flex flex-col gap-1">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.browserStorage.title') }}
        </div>
        <div class="text-xs text-ui-text-muted">
          {{ t('videoEditor.settings.browserStorage.description') }}
        </div>
      </div>

      <div v-if="usageLabel" class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between text-xs text-ui-text-muted">
          <span>{{ t('videoEditor.settings.browserStorage.usageLabel') }}</span>
          <span class="tabular-nums">
            {{ usageLabel }}
            <template v-if="usagePercent != null"> ({{ usagePercent }}%)</template>
          </span>
        </div>
        <div v-if="usagePercent != null" class="h-2 w-full rounded-full bg-ui-bg-elevated/60">
          <div
            class="h-full rounded-full bg-primary-500 transition-all"
            :style="{ width: `${usagePercent}%` }"
          />
        </div>
        <UiAlert variant="info" :icon="undefined" class="mt-1">
          {{ t('videoEditor.settings.browserStorage.quotaHint') }}
        </UiAlert>
      </div>

      <!-- Persistent storage toggle -->
      <UiAlert v-if="!isPersistSupported" variant="warning" icon="i-heroicons-exclamation-triangle">
        {{ t('videoEditor.settings.browserStorage.persistUnsupported') }}
      </UiAlert>
      <div v-else class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon
              :name="isPersisted ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
              class="w-4 h-4 shrink-0"
              :class="isPersisted ? 'text-emerald-400' : 'text-amber-400'"
            />
            <span class="text-xs text-ui-text-muted">
              {{
                isPersisted
                  ? t('videoEditor.settings.browserStorage.persistedOn')
                  : t('videoEditor.settings.browserStorage.persistedOff')
              }}
            </span>
          </div>
          <UButton
            v-if="!isPersisted"
            color="primary"
            variant="soft"
            size="sm"
            icon="i-heroicons-lock-closed"
            :loading="isRequestingPersist"
            :label="t('videoEditor.settings.browserStorage.requestPersist')"
            @click="requestPersist"
          />
        </div>
        <UiAlert v-if="persistDeclined" variant="warning" icon="i-heroicons-exclamation-triangle">
          {{ t('videoEditor.settings.browserStorage.persistDeclined') }}
        </UiAlert>
        <UiAlert v-else-if="!isPersisted" variant="info" :icon="undefined">
          {{ t('videoEditor.settings.browserStorage.persistHint') }}
        </UiAlert>
      </div>
    </div>

    <div
      v-if="isBrowserWorkspaceMode || isDesktopTauri"
      class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border"
    >
      <div class="flex flex-col gap-1 min-w-0">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.clearTempWorkspace') }}
        </div>
        <div class="text-xs text-ui-text-muted">
          {{ t('videoEditor.settings.clearTempWorkspaceHint') }}
        </div>
      </div>

      <UButton
        color="warning"
        variant="soft"
        icon="i-heroicons-trash"
        :label="t('videoEditor.settings.clearTempWorkspaceAction')"
        @click="void (isClearWorkspaceVardataConfirmOpen = true)"
      />
    </div>
  </div>
</template>
