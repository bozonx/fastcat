<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { DEFAULT_APP_SETTINGS } from '~/utils/settings/defaults';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isClearWorkspaceVardataConfirmOpen = ref(false);

const isDesktopTauri = computed(() => workspaceStore.workspaceProviderId === 'tauri');

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

async function confirmClearWorkspaceVardata() {
  isClearWorkspaceVardataConfirmOpen.value = false;
  await workspaceStore.clearVardata();
}

function resetPathDefaults() {
  workspaceStore.appSettings.paths.contentRootPath = DEFAULT_APP_SETTINGS.paths.contentRootPath;
  workspaceStore.appSettings.paths.dataRootPath = DEFAULT_APP_SETTINGS.paths.dataRootPath;
  workspaceStore.appSettings.paths.tempRootPath = DEFAULT_APP_SETTINGS.paths.tempRootPath;
  workspaceStore.appSettings.paths.proxiesRootPath = DEFAULT_APP_SETTINGS.paths.proxiesRootPath;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.workspaceStorage', 'Storage') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetPathDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset paths') }}
      </UButton>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <UFormField
        :label="t('videoEditor.settings.contentRootPath', 'Content root path')"
        :help="
          t(
            'videoEditor.settings.contentRootPathHelp',
            'Projects and common content use this shared parent path on desktop. Leave empty to use the default OS location.',
          )
        "
      >
        <UInput v-model="contentRootPath" :disabled="!isDesktopTauri" class="w-full" />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.dataRootPath', 'Data root path')"
        :help="
          t(
            'videoEditor.settings.dataRootPathHelp',
            'Reserved for future persistent application libraries such as plugins, sticker packs or shared installed assets.',
          )
        "
      >
        <UInput v-model="dataRootPath" :disabled="!isDesktopTauri" class="w-full" />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.tempRootPath', 'Temporary data path')"
        :help="
          t(
            'videoEditor.settings.tempRootPathHelp',
            'Location for rebuildable cache, thumbnails, waveforms and temporary files. Leave empty to use the default OS cache location.',
          )
        "
      >
        <UInput v-model="tempRootPath" :disabled="!isDesktopTauri" class="w-full" />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.proxiesRootPath', 'Proxy files path')"
        :help="
          t(
            'videoEditor.settings.proxiesRootPathHelp',
            'Generated proxy media can use a dedicated path. Leave empty to use the default application location.',
          )
        "
      >
        <UInput v-model="proxiesRootPath" :disabled="!isDesktopTauri" class="w-full" />
      </UFormField>
    </div>

    <div v-if="!isDesktopTauri" class="text-xs text-ui-text-muted rounded border border-ui-border p-3">
      {{
        t(
          'videoEditor.settings.storagePathEnvironmentHint',
          'Custom path overrides are currently available only in desktop mode. In OPFS and portable modes, FastCat stores config and workspace data inside the selected workspace.',
        )
      }}
    </div>

    <UiConfirmModal
      v-model:open="isClearWorkspaceVardataConfirmOpen"
      :title="t('videoEditor.settings.clearTempWorkspaceTitle', 'Clear temporary files')"
      :description="
        t(
          'videoEditor.settings.clearTempWorkspaceDescription',
          'This will delete all generated proxies, thumbnails and cached data in this workspace.',
        )
      "
      :confirm-text="t('videoEditor.settings.clearTempWorkspaceConfirm', 'Clear')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearWorkspaceVardata"
    />

    <div class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border">
      <div class="flex flex-col gap-1 min-w-0">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.clearTempWorkspace', 'Clear temporary files') }}
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
        :label="t('videoEditor.settings.clearTempWorkspaceAction', 'Clear')"
        @click="isClearWorkspaceVardataConfirmOpen = true"
      />
    </div>
  </div>
</template>
