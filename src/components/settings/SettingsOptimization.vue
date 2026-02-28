<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-sm font-medium text-ui-text">
      {{ t('videoEditor.settings.userOptimization', 'Optimization') }}
    </div>

    <div
      class="p-3 bg-primary-950/40 text-primary-200 rounded text-sm border border-primary-800/30"
    >
      {{
        t(
          'videoEditor.settings.proxyInfo',
          'Proxy files are used to improve playback performance in the editor. They are generated in WebM format with VP9 video codec and Opus audio codec.',
        )
      }}
    </div>

    <div class="grid grid-cols-4 gap-4">
      <UFormField :label="t('videoEditor.settings.proxyResolution', 'Proxy resolution')">
        <USelectMenu
          v-model="workspaceStore.userSettings.optimization.proxyResolution"
          :items="[
            { label: '360p', value: '360p' },
            { label: '480p', value: '480p' },
            { label: '720p', value: '720p' },
            { label: '1080p', value: '1080p' },
          ]"
          value-key="value"
          label-key="label"
          class="w-full"
          @update:model-value="
            (v: any) => (workspaceStore.userSettings.optimization.proxyResolution = v?.value ?? v)
          "
        />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.proxyVideoBitrate', 'Video bitrate (Mbps)')"
        :help="
          t(
            'videoEditor.settings.proxyVideoBitrateHelp',
            'Higher bitrate means better quality but larger file size',
          )
        "
      >
        <UInput
          v-model.number="workspaceStore.userSettings.optimization.proxyVideoBitrateMbps"
          type="number"
          inputmode="numeric"
          min="0.1"
          max="50"
          step="0.1"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('videoEditor.settings.proxyAudioBitrate', 'Audio bitrate (kbps)')">
        <UInput
          v-model.number="workspaceStore.userSettings.optimization.proxyAudioBitrateKbps"
          type="number"
          inputmode="numeric"
          min="32"
          max="512"
          step="32"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('videoEditor.settings.proxyConcurrency', 'Concurrency')">
        <UInput
          v-model.number="workspaceStore.userSettings.optimization.proxyConcurrency"
          type="number"
          inputmode="numeric"
          min="1"
          max="16"
          step="1"
          class="w-full"
        />
      </UFormField>
    </div>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.optimization.proxyCopyOpusAudio" />
      <span class="text-sm text-ui-text">
        {{
          t(
            'videoEditor.settings.proxyCopyOpusAudio',
            'Copy Opus audio directly without re-encoding',
          )
        }}
      </span>
    </label>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.optimization.autoCreateProxies" />
      <span class="text-sm text-ui-text">
        {{
          t(
            'videoEditor.settings.autoCreateProxies',
            'Automatically create proxies when adding media to the timeline',
          )
        }}
      </span>
    </label>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
