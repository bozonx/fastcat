<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import AppModal from '~/components/ui/AppModal.vue';
import SettingsGeneral from '~/components/settings/SettingsGeneral.vue';
import SettingsHotkeys from '~/components/settings/SettingsHotkeys.vue';
import SettingsMouse from '~/components/settings/SettingsMouse.vue';
import SettingsOptimization from '~/components/settings/SettingsOptimization.vue';
import SettingsProjectDefaults from '~/components/settings/SettingsProjectDefaults.vue';
import SettingsExportDefaults from '~/components/settings/SettingsExportDefaults.vue';
import SettingsStorage from '~/components/settings/SettingsStorage.vue';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

type SettingsSection =
  | 'user.general'
  | 'user.hotkeys'
  | 'user.mouse'
  | 'user.optimization'
  | 'user.project'
  | 'user.export'
  | 'workspace.storage';

const activeSection = ref<SettingsSection>('user.general');

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const hotkeysRef = ref<InstanceType<typeof SettingsHotkeys> | null>(null);

watch(
  () => props.open,
  async (v, prev) => {
    if (prev && !v) {
      await workspaceStore.flushSettingsSaves();
    }

    if (!v && hotkeysRef.value) {
      hotkeysRef.value.isDuplicateConfirmOpen = false;
      hotkeysRef.value.finishCapture();
    }
  },
);
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.settings.title', 'Editor settings')"
    :ui="{
      content: 'sm:max-w-4xl h-[90vh]',
      body: '!p-0 !overflow-hidden flex flex-col',
    }"
  >
    <div class="flex flex-1 min-h-0 w-full h-full">
      <div class="w-56 shrink-0 p-6 bg-ui-bg border-r border-ui-border overflow-y-auto">
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.userSection', 'User settings') }}
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userGeneral', 'General')"
              :disabled="activeSection === 'user.general'"
              @click="activeSection = 'user.general'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userHotkeys', 'Hotkeys')"
              :disabled="activeSection === 'user.hotkeys'"
              @click="activeSection = 'user.hotkeys'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userMouse', 'Mouse')"
              :disabled="activeSection === 'user.mouse'"
              @click="activeSection = 'user.mouse'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userOptimization', 'Optimization')"
              :disabled="activeSection === 'user.optimization'"
              @click="activeSection = 'user.optimization'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userProject', 'Project defaults')"
              :disabled="activeSection === 'user.project'"
              @click="activeSection = 'user.project'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userExport', 'Export defaults')"
              :disabled="activeSection === 'user.export'"
              @click="activeSection = 'user.export'"
            />
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.workspaceSection', 'Workspace settings') }}
            </div>
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.workspaceStorage', 'Storage')"
              :disabled="activeSection === 'workspace.storage'"
              @click="activeSection = 'workspace.storage'"
            />
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0 p-6 overflow-y-auto">
        <SettingsGeneral v-if="activeSection === 'user.general'" />
        <SettingsHotkeys v-else-if="activeSection === 'user.hotkeys'" ref="hotkeysRef" />
        <SettingsMouse v-else-if="activeSection === 'user.mouse'" />
        <SettingsOptimization v-else-if="activeSection === 'user.optimization'" />
        <SettingsProjectDefaults v-else-if="activeSection === 'user.project'" />
        <SettingsExportDefaults
          v-else-if="activeSection === 'user.export'"
          :is-active="activeSection === 'user.export'"
        />
        <SettingsStorage v-else-if="activeSection === 'workspace.storage'" />
      </div>
    </div>
  </AppModal>
</template>
