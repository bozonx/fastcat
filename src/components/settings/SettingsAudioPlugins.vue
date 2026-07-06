<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import UiAlert from '~/components/ui/UiAlert.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAudioPluginsStore } from '~/stores/audio-plugins.store';
import { DEFAULT_USER_SETTINGS, type AudioPluginFormat } from '~/utils/settings';
import { getPlatformCapabilities } from '~/utils/capabilities';
import type { NativeAudioPluginDescriptor } from '~/utils/audio/native-audio-plugins';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('SettingsAudioPlugins');

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const audioPluginsStore = useAudioPluginsStore();
const isTauri = computed(() => getPlatformCapabilities().nativeAudioPlugins);

// Scanning and its results are shared with the editor (effect pickers) via the
// store, so discovering a plugin here immediately makes it selectable there.
const { plugins: scannedPlugins, isScanning, error: scanError } = storeToRefs(audioPluginsStore);
const manualPath = ref('');

const pluginSettings = computed(() => workspaceStore.userSettings.audioPlugins);

const formatOptions: Array<{ value: AudioPluginFormat; label: string }> = [
  { value: 'clap', label: 'CLAP' },
  { value: 'lv2', label: 'LV2' },
  { value: 'vst3', label: 'VST3' },
];

function isFormatEnabled(format: AudioPluginFormat): boolean {
  return pluginSettings.value.enabledFormats.includes(format);
}

function toggleFormat(format: AudioPluginFormat, enabled: boolean) {
  const current = new Set(pluginSettings.value.enabledFormats);
  if (enabled) {
    current.add(format);
  } else if (current.size > 1) {
    current.delete(format);
  }
  pluginSettings.value.enabledFormats = [...current];
}

function addPath(path: string) {
  const normalized = path.trim();
  if (!normalized || pluginSettings.value.customScanPaths.includes(normalized)) {
    manualPath.value = '';
    return;
  }
  pluginSettings.value.customScanPaths = [...pluginSettings.value.customScanPaths, normalized];
  manualPath.value = '';
}

function removePath(path: string) {
  pluginSettings.value.customScanPaths = pluginSettings.value.customScanPaths.filter(
    (candidate) => candidate !== path,
  );
}

async function browsePath() {
  if (!isTauri.value) return;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('videoEditor.settings.audioPlugins.addPath'),
    });
    if (typeof selected === 'string') {
      addPath(selected);
    }
  } catch (err) {
    log.error('Failed to choose audio plugin folder:', err);
  }
}

async function scanPlugins() {
  await audioPluginsStore.scan();
}

function resetDefaults() {
  workspaceStore.userSettings.audioPlugins = {
    ...DEFAULT_USER_SETTINGS.audioPlugins,
    enabledFormats: [...DEFAULT_USER_SETTINGS.audioPlugins.enabledFormats],
    customScanPaths: [...DEFAULT_USER_SETTINGS.audioPlugins.customScanPaths],
  };
}

function statusLabel(plugin: NativeAudioPluginDescriptor): string {
  if (plugin.isLoadable) {
    return t('videoEditor.settings.audioPlugins.statusLoadable');
  }
  return t('videoEditor.settings.audioPlugins.statusHostUnavailable');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.audioPlugins.title') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <UiAlert v-if="!isTauri" variant="warning" icon="i-heroicons-exclamation-triangle">
      {{ t('videoEditor.settings.audioPlugins.tauriOnly') }}
    </UiAlert>

    <template v-else>
      <label class="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.audioPlugins.enable') }}
        </span>
        <USwitch v-model="pluginSettings.enabled" />
      </label>

      <label
        class="flex items-center justify-between gap-3 select-none"
        :class="[!pluginSettings.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer']"
      >
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.audioPlugins.scanOnStartup') }}
        </span>
        <USwitch v-model="pluginSettings.scanOnStartup" :disabled="!pluginSettings.enabled" />
      </label>

      <UiFormField
        :label="t('videoEditor.settings.audioPlugins.formats')"
        :help="t('videoEditor.settings.audioPlugins.formatsHelp')"
      >
        <div class="flex flex-wrap gap-3">
          <UCheckbox
            v-for="option in formatOptions"
            :key="option.value"
            :model-value="isFormatEnabled(option.value)"
            :label="option.label"
            @update:model-value="
              (value: boolean | 'indeterminate') => toggleFormat(option.value, value === true)
            "
          />
        </div>
      </UiFormField>

      <UiFormField
        :label="t('videoEditor.settings.audioPlugins.scanPaths')"
        :help="t('videoEditor.settings.audioPlugins.scanPathsHelp')"
      >
        <div class="flex flex-col gap-2">
          <div class="flex gap-2">
            <UiTextInput
              v-model="manualPath"
              full-width
              mono
              :placeholder="t('videoEditor.settings.audioPlugins.pathPlaceholder')"
              @keyup.enter="addPath(manualPath)"
            />
            <UButton
              icon="i-heroicons-folder-open"
              color="neutral"
              variant="outline"
              :aria-label="t('videoEditor.settings.audioPlugins.browsePath')"
              @click="browsePath"
            />
            <UButton
              icon="i-heroicons-plus"
              color="neutral"
              variant="outline"
              :disabled="manualPath.trim().length === 0"
              :aria-label="t('videoEditor.settings.audioPlugins.addPath')"
              @click="addPath(manualPath)"
            />
          </div>

          <div
            v-if="pluginSettings.customScanPaths.length > 0"
            class="flex flex-col divide-y divide-ui-border-muted rounded-md border border-ui-border-muted"
          >
            <div
              v-for="path in pluginSettings.customScanPaths"
              :key="path"
              class="flex items-center gap-2 px-3 py-2"
            >
              <span class="min-w-0 flex-1 truncate font-mono text-xs text-ui-text-muted">
                {{ path }}
              </span>
              <UButton
                icon="i-heroicons-x-mark"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('common.remove')"
                @click="removePath(path)"
              />
            </div>
          </div>
        </div>
      </UiFormField>

      <div class="flex items-center justify-between gap-3 border-t border-ui-border-muted/50 pt-4">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.audioPlugins.discoveredPlugins') }}
        </div>
        <UButton
          icon="i-heroicons-magnifying-glass"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="isScanning"
          :disabled="isScanning"
          @click="scanPlugins"
        >
          {{ t('videoEditor.settings.audioPlugins.scan') }}
        </UButton>
      </div>

      <UiAlert v-if="scanError" variant="error" icon="i-heroicons-exclamation-circle">
        {{ scanError }}
      </UiAlert>

      <div
        v-if="scannedPlugins.length === 0"
        class="rounded-md border border-ui-border-muted bg-ui-bg-muted/40 px-3 py-3 text-sm text-ui-text-muted"
      >
        {{ t('videoEditor.settings.audioPlugins.noPlugins') }}
      </div>

      <div
        v-else
        class="flex flex-col divide-y divide-ui-border-muted rounded-md border border-ui-border-muted"
      >
        <div
          v-for="plugin in scannedPlugins"
          :key="plugin.id"
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-ui-text">
              {{ plugin.name }}
            </div>
            <div class="truncate font-mono text-xs text-ui-text-muted">
              {{ plugin.path }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded border border-ui-border-muted px-1.5 py-0.5 text-[11px] uppercase">
              {{ plugin.format }}
            </span>
            <span class="text-xs text-amber-300">
              {{ statusLabel(plugin) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
