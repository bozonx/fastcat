<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetDefaults() {
  workspaceStore.userSettings.optimization = { ...DEFAULT_USER_SETTINGS.optimization };
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="
        t('videoEditor.settings.resetOptimizationSettingsConfirmTitle', 'Reset optimization?')
      "
      :description="
        t(
          'videoEditor.settings.resetOptimizationSettingsConfirmDesc',
          'This will restore all optimization settings to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userOptimization', 'Optimization') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
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
      <UFormField :label="t('videoEditor.settings.proxyMaxPixels', 'Max proxy resolution')">
        <USelectMenu
          v-slot="{ modelValue }"
          v-model="workspaceStore.userSettings.optimization.proxyMaxPixels"
          :items="[
            { label: '3.0 MP (1080p+)', value: 3_000_000 },
            { label: '1.5 MP (720p+)', value: 1_500_000 },
            { label: '0.7 MP (480p+)', value: 700_000 },
            { label: '0.4 MP (360p+)', value: 400_000 },
            { label: '0.2 MP (240p+)', value: 200_000 },
          ]"
          value-key="value"
          label-key="label"
          class="w-full"
          @update:model-value="
            (v: any) => (workspaceStore.userSettings.optimization.proxyMaxPixels = v?.value ?? v)
          "
        >
          <UButton
            color="neutral"
            variant="outline"
            class="w-full justify-between"
            :label="
              [
                { label: '3.0 MP (1080p+)', value: 3_000_000 },
                { label: '1.5 MP (720p+)', value: 1_500_000 },
                { label: '0.7 MP (480p+)', value: 700_000 },
                { label: '0.4 MP (360p+)', value: 400_000 },
                { label: '0.2 MP (240p+)', value: 200_000 },
              ].find((i) => i.value === workspaceStore.userSettings.optimization.proxyMaxPixels)
                ?.label || workspaceStore.userSettings.optimization.proxyMaxPixels + ' px'
            "
            icon-trailing="i-lucide-chevron-down"
          />
        </USelectMenu>
      </UFormField>

      <UFormField :label="t('videoEditor.settings.proxyConcurrency', 'Concurrency')">
        <WheelNumberInput
          v-model="workspaceStore.userSettings.optimization.proxyConcurrency"
          :min="1"
          :max="16"
          :step="1"
        />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.videoFrameCacheMb', 'Video frame cache (MB)')"
        :help="
          t(
            'videoEditor.settings.videoFrameCacheMbHelp',
            'Maximum RAM budget for decoded preview video frames. Set 0 to disable the cache.',
          )
        "
      >
        <WheelNumberInput
          v-model="workspaceStore.userSettings.optimization.videoFrameCacheMb"
          :min="0"
          :max="4096"
          :step="16"
        />
      </UFormField>
    </div>

    <div class="grid grid-cols-4 gap-4">
      <UFormField
        :label="t('videoEditor.settings.proxyVideoBitrate', 'Video bitrate (Mbps)')"
        :help="
          t(
            'videoEditor.settings.proxyVideoBitrateHelp',
            'Higher bitrate means better quality but larger file size',
          )
        "
      >
        <WheelNumberInput
          v-model="workspaceStore.userSettings.optimization.proxyVideoBitrateMbps"
          :min="0.1"
          :max="50"
          :step="0.1"
        />
      </UFormField>

      <UFormField :label="t('videoEditor.settings.proxyAudioBitrate', 'Audio bitrate (kbps)')">
        <WheelNumberInput
          v-model="workspaceStore.userSettings.optimization.proxyAudioBitrateKbps"
          :min="32"
          :max="512"
          :step="16"
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
