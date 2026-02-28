<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isClearWorkspaceVardataConfirmOpen = ref(false);

const proxyLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.proxyStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.proxyStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});

const cacheLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.cacheStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.cacheStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});

const thumbnailsLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.thumbnailsStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.thumbnailsStorageLimitBytes = Math.round(
      n * 1024 * 1024 * 1024,
    );
  },
});

async function confirmClearWorkspaceVardata() {
  isClearWorkspaceVardataConfirmOpen.value = false;
  await workspaceStore.clearVardata();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-sm font-medium text-ui-text">
      {{ t('videoEditor.settings.workspaceStorage', 'Storage') }}
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

    <div class="grid grid-cols-3 gap-4">
      <UFormField
        :label="t('videoEditor.settings.proxyLimit', 'Proxy storage limit (GB)')"
        :help="
          t(
            'videoEditor.settings.proxyLimitHelp',
            'Total limit for all proxy files in this workspace',
          )
        "
      >
        <UInput
          v-model.number="proxyLimitGb"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.cacheLimit', 'Cache storage limit (GB)')"
        :help="
          t('videoEditor.settings.cacheLimitHelp', 'Total limit for cached data in this workspace')
        "
      >
        <UInput
          v-model.number="cacheLimitGb"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.thumbnailsLimit', 'Thumbnails storage limit (GB)')"
        :help="
          t(
            'videoEditor.settings.thumbnailsLimitHelp',
            'Total limit for generated thumbnails in this workspace',
          )
        "
      >
        <UInput
          v-model.number="thumbnailsLimitGb"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          class="w-full"
        />
      </UFormField>
    </div>

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

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.workspaceSavedNote', 'Saved to .gran/workspace.settings.json') }}
    </div>
  </div>
</template>
