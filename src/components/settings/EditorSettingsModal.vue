<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiModal from '~/components/ui/UiModal.vue';
import SettingsGeneral from '~/components/settings/SettingsGeneral.vue';
import SettingsHotkeys from '~/components/settings/SettingsHotkeys.vue';
import SettingsMouse from '~/components/settings/SettingsMouse.vue';
import SettingsOptimization from '~/components/settings/SettingsOptimization.vue';
import SettingsProjectDefaults from '~/components/settings/SettingsProjectDefaults.vue';
import SettingsExportDefaults from '~/components/settings/SettingsExportDefaults.vue';
import SettingsIntegrations from '~/components/settings/SettingsIntegrations.vue';
import SettingsVideo from '~/components/settings/SettingsVideo.vue';
import SettingsAudio from '~/components/settings/SettingsAudio.vue';
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
  | 'user.proxy'
  | 'user.project'
  | 'user.export'
  | 'user.integrations'
  | 'user.video'
  | 'user.audio'
  | 'workspace.storage';

const STORAGE_KEY = 'fastcat:settings:active-section';
const EXPIRATION_MS = 24 * 60 * 60 * 1000;

function getStoredSection(): SettingsSection {
  if (typeof window === 'undefined') return 'user.general';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'user.general';
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > EXPIRATION_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return 'user.general';
    }
    return parsed.section as SettingsSection;
  } catch {
    return 'user.general';
  }
}

const activeSection = ref<SettingsSection>(getStoredSection());

watch(activeSection, (section) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ section, timestamp: Date.now() }));
  } catch {
    // ignore
  }
});

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
    :title="t('videoEditor.settings.title', 'Editor settings')"
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
              {{ t('videoEditor.settings.userSection', 'User settings') }}
            </div>
            <UiToggleButton
              :model-value="activeSection === 'user.general'"
              label="General"
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
              label="Hotkeys"
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
              label="Mouse"
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
              :model-value="activeSection === 'user.project'"
              label="Project presets"
              inactive-color="neutral"
              active-color="neutral"
              :active-bg="'color-mix(in srgb, var(--selection-accent-500) 15%, transparent)'" 
              :active-text="'var(--selection-accent-400)'"
              inactive-variant="ghost"
              active-variant="soft"
              no-toggle
              class="justify-start"
              @click="activeSection = 'user.project'"
            />
            <UiToggleButton
              :model-value="activeSection === 'user.export'"
              label="Export presets"
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
              label="Proxy"
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
              label="Video"
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
              label="Audio"
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
              :model-value="activeSection === 'user.integrations'"
              label="Integrations"
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
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
              {{ t('videoEditor.settings.workspaceSection', 'Application settings') }}
            </div>
            <UiToggleButton
              :model-value="activeSection === 'workspace.storage'"
              label="Storage"
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
        <SettingsProjectDefaults v-else-if="activeSection === 'user.project'" />
        <SettingsExportDefaults
          v-else-if="activeSection === 'user.export'"
          :is-active="activeSection === 'user.export'"
        />
        <SettingsVideo v-else-if="activeSection === 'user.video'" />
        <SettingsAudio v-else-if="activeSection === 'user.audio'" />
        <SettingsIntegrations v-else-if="activeSection === 'user.integrations'" />
        <SettingsStorage v-else-if="activeSection === 'workspace.storage'" />
      </div>
    </div>
  </UiModal>
</template>
