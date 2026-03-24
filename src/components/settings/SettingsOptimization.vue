<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';

import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

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
      :title="t('videoEditor.settings.resetProxySettingsConfirmTitle', 'Reset proxy settings?')"
      :description="
        t(
          'videoEditor.settings.resetProxySettingsConfirmDesc',
          'This will restore all proxy settings to their default values.',
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
        {{ t('videoEditor.settings.userProxy', 'Proxy') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div
      class="p-3 bg-primary-950/40 text-primary-200 rounded text-sm border border-primary-800/30"
    >
      {{ t('videoEditor.settings.proxyInfo') }}
    </div>

    <div class="grid grid-cols-2 gap-4">
      <UiFormField :label="t('videoEditor.settings.proxyVideoCodec')">
        <UiButtonGroup
          v-model="workspaceStore.userSettings.optimization.proxyVideoCodec"
          :options="[
            { label: 'AV1', value: 'av1' },
            { label: 'H264', value: 'h264' },
          ]"
          fluid
        />
      </UiFormField>

      <UiFormField :label="t('videoEditor.settings.proxyMaxPixels')">
        <UiSelect
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
          full-width
          @update:model-value="
            (v: unknown) =>
              (workspaceStore.userSettings.optimization.proxyMaxPixels =
                (v as { value: number })?.value ?? (v as number))
          "
        />
      </UiFormField>

      <UiFormField :label="t('videoEditor.settings.proxyVideoBitrate')">
        <UiWheelNumberInput
          v-model="workspaceStore.userSettings.optimization.proxyVideoBitrateMbps"
          :min="0.1"
          :max="50"
          :step="0.1"
          full-width
        />
      </UiFormField>

      <UiFormField :label="t('videoEditor.settings.proxyAudioBitrate')">
        <UiWheelNumberInput
          v-model="workspaceStore.userSettings.optimization.proxyAudioBitrateKbps"
          :min="32"
          :max="512"
          :step="16"
          full-width
        />
      </UiFormField>
    </div>

    <label
      class="flex items-center gap-3 cursor-pointer"
      :title="
        t(
          'videoEditor.settings.proxyCopyOpusAudioHelp',
          'Enabling this will skip audio transcoding if the source already has Opus audio, preserving quality and saving time.',
        )
      "
    >
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
  </div>
</template>
