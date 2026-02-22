<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import AppModal from '~/components/ui/AppModal.vue';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const proxyLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.proxyStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.proxyStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});
</script>

<template>
  <AppModal v-model:open="isOpen" :title="t('videoEditor.settings.title', 'Editor settings')">
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-4">
        <div class="text-sm font-medium text-gray-900 dark:text-gray-200">
          {{ t('videoEditor.settings.userSection', 'User settings') }}
        </div>

        <UFormField
          :label="t('videoEditor.settings.openBehavior', 'On editor open')"
          :help="
            t(
              'videoEditor.settings.openBehaviorHelp',
              'Controls what happens after workspace is opened',
            )
          "
        >
          <UiAppButtonGroup
            :model-value="workspaceStore.userSettings.openBehavior"
            :options="[
              {
                value: 'open_last_project',
                label: t('videoEditor.settings.openLastProject', 'Open last project'),
              },
              {
                value: 'show_project_picker',
                label: t('videoEditor.settings.showProjectPicker', 'Show project picker'),
              },
            ]"
            @update:model-value="(val: any) => (workspaceStore.userSettings.openBehavior = val)"
          />
        </UFormField>

        <div class="text-xs text-gray-500">
          {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <div class="text-sm font-medium text-gray-900 dark:text-gray-200">
          {{ t('videoEditor.settings.workspaceSection', 'Workspace settings') }}
        </div>

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

        <div class="grid grid-cols-2 gap-3">
          <UFormField
            :label="t('videoEditor.settings.defaultProjectWidth', 'Default project width')"
          >
            <UInput
              v-model.number="workspaceStore.workspaceSettings.defaults.newProject.width"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.defaultProjectHeight', 'Default project height')"
          >
            <UInput
              v-model.number="workspaceStore.workspaceSettings.defaults.newProject.height"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField :label="t('videoEditor.settings.defaultProjectFps', 'Default project FPS')">
          <UInput
            v-model.number="workspaceStore.workspaceSettings.defaults.newProject.fps"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="w-full"
          />
        </UFormField>

        <div class="text-xs text-gray-500">
          {{ t('videoEditor.settings.workspaceSavedNote', 'Saved to .gran/workspace.settings.json') }}
        </div>
      </div>
    </div>
  </AppModal>
</template>
