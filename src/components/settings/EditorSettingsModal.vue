<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiModal from '~/components/ui/UiModal.vue';
import SettingsGeneral from '~/components/settings/SettingsGeneral.vue';
import SettingsHotkeys from '~/components/settings/SettingsHotkeys.vue';
import SettingsMouse from '~/components/settings/SettingsMouse.vue';
import SettingsOptimization from '~/components/settings/SettingsOptimization.vue';
import SettingsExportDefaults from '~/components/settings/SettingsExportDefaults.vue';
import SettingsIntegrations from '~/components/settings/SettingsIntegrations.vue';
import SettingsVideo from '~/components/settings/SettingsVideo.vue';
import SettingsAudio from '~/components/settings/SettingsAudio.vue';
import SettingsStorage from '~/components/settings/SettingsStorage.vue';
import SettingsUi from '~/components/settings/SettingsUi.vue';
import { useUiStore } from '~/stores/ui.store';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const uiStore = useUiStore();

type SettingsSection =
  | 'user.general'
  | 'user.hotkeys'
  | 'user.mouse'
  | 'user.proxy'
  | 'user.export'
  | 'user.integrations'
  | 'user.video'
  | 'user.audio'
  | 'user.ui'
  | 'workspace.storage';

const savedSection = uiStore.editorSettingsActiveSection;
const activeSection = ref<SettingsSection>(
  savedSection === 'user.project' || !savedSection
    ? 'user.general'
    : (savedSection as SettingsSection),
);

watch(activeSection, (section) => {
  uiStore.editorSettingsActiveSection = section;
});

watch(
  () => uiStore.editorSettingsActiveSection,
  (section) => {
    if (section && section !== activeSection.value) {
      activeSection.value = section as SettingsSection;
    }
  },
);

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
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.settings.title')"
    :ui="{
      content: 'sm:max-w-4xl h-[90vh]',
      body: '!p-0 !overflow-hidden flex flex-col',
    }"
  >
    <div class="flex flex-1 min-h-0 w-full h-full">
      <div class="w-56 shrink-0 px-4 py-4 bg-ui-bg border-r border-ui-border overflow-y-auto">
        <div class="flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.userSection') }}
            </div>
            <UiToggleButton
              :model-value="activeSection === 'user.general'"
              :label="t('videoEditor.settings.userGeneral')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.general'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.hotkeys'"
              :label="t('videoEditor.settings.userHotkeys')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.hotkeys'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.mouse'"
              :label="t('videoEditor.settings.userMouse')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.mouse'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.export'"
              :label="t('videoEditor.settings.userExport')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.export'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.proxy'"
              :label="t('videoEditor.settings.userProxy')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.proxy'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.video'"
              :label="t('videoEditor.settings.userVideo')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.video'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.audio'"
              :label="t('videoEditor.settings.userAudio')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.audio'"
            />
            <UiToggleButton
              v-if="workspaceStore.userSettings.experimentalFeatures"
              :model-value="activeSection === 'user.integrations'"
              :label="t('videoEditor.settings.userIntegrations')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.integrations'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.ui'"
              :label="t('videoEditor.settings.userUi')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.ui'"
            />
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.workspaceSection') }}
            </div>
            <UiToggleButton
              :model-value="activeSection === 'workspace.storage'"
              :label="t('videoEditor.settings.workspaceStorage')"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'"
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'workspace.storage'"
            />
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0 px-4 py-4 overflow-y-auto">
        <SettingsGeneral v-if="activeSection === 'user.general'" />
        <SettingsHotkeys v-else-if="activeSection === 'user.hotkeys'" ref="hotkeysRef" />
        <SettingsMouse v-else-if="activeSection === 'user.mouse'" />
        <SettingsOptimization v-else-if="activeSection === 'user.proxy'" />
        <SettingsExportDefaults
          v-else-if="activeSection === 'user.export'"
          :is-active="activeSection === 'user.export'"
        />
        <SettingsVideo v-else-if="activeSection === 'user.video'" />
        <SettingsAudio v-else-if="activeSection === 'user.audio'" />
        <SettingsIntegrations v-else-if="activeSection === 'user.integrations'" />
        <SettingsUi v-else-if="activeSection === 'user.ui'" />
        <SettingsStorage v-else-if="activeSection === 'workspace.storage'" />
      </div>
    </div>
  </UiModal>
</template>
