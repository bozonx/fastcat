<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TICKS_PER_MILLISECOND } from '~/utils/time';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import { getPlatformCapabilities } from '~/utils/capabilities';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import { createDevLogger } from '~/utils/dev-logger';
import {
  checkAudioCodecSupport,
  checkAudioDecoderSupport,
  BASE_AUDIO_CODEC_OPTIONS,
} from '~/utils/webcodecs';

const log = createDevLogger('SettingsAudio');

interface FfmpegComponentDiagnostic {
  name: string;
  label: string;
  supported: boolean;
}

interface FfmpegCodecDiagnostic {
  label: string;
  key: string;
  decoders: FfmpegComponentDiagnostic[];
  encoders: FfmpegComponentDiagnostic[];
}

interface FfmpegDiagnostics {
  ffmpegAvailable: boolean;
  ffmpegVersion: string;
  ffprobeAvailable: boolean;
  ffprobeVersion: string;
  hwaccels: string[];
  codecs: FfmpegCodecDiagnostic[];
}

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const isTauri = computed(() => getPlatformCapabilities().nativeAudioEngine);

const isResetConfirmOpen = ref(false);

const tauriDiagnostics = ref<FfmpegDiagnostics | null>(null);
const isLoadingTauriDiagnostics = ref(false);

const webAudioDecodeSupport = ref<Record<string, boolean>>({});
const webAudioEncodeSupport = ref<Record<string, boolean>>({});
const isLoadingWebDiagnostics = ref(false);

async function loadTauriDiagnostics() {
  if (!isTauri.value) return;
  isLoadingTauriDiagnostics.value = true;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    tauriDiagnostics.value = await invoke<FfmpegDiagnostics>('native_get_ffmpeg_diagnostics', {
      ffmpegPath: workspaceStore.userSettings.optimization.ffmpegPath || null,
      ffprobePath: workspaceStore.userSettings.optimization.ffprobePath || null,
    });
  } catch (err) {
    log.error('Failed to load Tauri FFmpeg diagnostics:', err);
    tauriDiagnostics.value = null;
  } finally {
    isLoadingTauriDiagnostics.value = false;
  }
}

async function loadWebDiagnostics() {
  if (isTauri.value) return;
  isLoadingWebDiagnostics.value = true;
  try {
    const [encodeSupport, decodeSupport] = await Promise.all([
      checkAudioCodecSupport(BASE_AUDIO_CODEC_OPTIONS),
      checkAudioDecoderSupport(BASE_AUDIO_CODEC_OPTIONS),
    ]);
    webAudioEncodeSupport.value = encodeSupport;
    webAudioDecodeSupport.value = decodeSupport;
  } catch (err) {
    log.error('Failed to load Web WebCodecs diagnostics:', err);
  } finally {
    isLoadingWebDiagnostics.value = false;
  }
}

function resetDefaults() {
  workspaceStore.userSettings.projectDefaults.audioDeclickDurationTicks =
    DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationTicks;
  workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled =
    DEFAULT_USER_SETTINGS.projectDefaults.audioScrubbingEnabled;
  workspaceStore.userSettings.audioEngine.bufferSize = DEFAULT_USER_SETTINGS.audioEngine.bufferSize;
  workspaceStore.userSettings.audioEngine.backend = DEFAULT_USER_SETTINGS.audioEngine.backend;
  isResetConfirmOpen.value = false;
}

onMounted(async () => {
  if (isTauri.value) {
    await loadTauriDiagnostics();
  } else {
    await loadWebDiagnostics();
  }
});

watch(
  () => [
    workspaceStore.userSettings.optimization.ffmpegPath,
    workspaceStore.userSettings.optimization.ffprobePath,
  ],
  async () => {
    if (isTauri.value) {
      await loadTauriDiagnostics();
    }
  },
);

// Forward native audio engine settings to the Rust backend.
watch(
  () => ({
    inDevelopmentFeaturesEnabled: workspaceStore.inDevelopmentFeaturesEnabled,
    bufferSize: workspaceStore.userSettings.audioEngine.bufferSize,
    backend: workspaceStore.userSettings.audioEngine.backend,
  }),
  async ({ inDevelopmentFeaturesEnabled, bufferSize, backend }) => {
    if (!isTauri.value) return;
    try {
      const settings: import('~/composables/monitor/native-monitor-ipc').MonitorAudioSettingsInput =
        inDevelopmentFeaturesEnabled
          ? { bufferSize: bufferSize as 'default' | number, backend: backend as 'default' | string }
          : { bufferSize: 'default', backend: 'default' };
      await nativeMonitorIpc.setAudioSettings(settings);
    } catch (err) {
      log.error('Failed to update audio engine settings:', err);
    }
  },
  { deep: true },
);

const AUDIO_DIAGNOSTIC_CODEC_KEYS = new Set(['aac', 'opus']);

interface AudioCodecRow {
  label: string;
  decodeSupported: boolean;
  encodeSupported: boolean;
}

const audioCodecRows = computed<AudioCodecRow[]>(() => {
  if (isTauri.value) {
    const codecs = tauriDiagnostics.value?.codecs || [];
    return codecs
      .filter((c) => AUDIO_DIAGNOSTIC_CODEC_KEYS.has(c.key))
      .map((c) => ({
        label: c.label,
        decodeSupported: c.decoders.some((d) => d.supported),
        encodeSupported: c.encoders.some((e) => e.supported),
      }));
  }

  return BASE_AUDIO_CODEC_OPTIONS.map((opt) => ({
    label: opt.label,
    decodeSupported: webAudioDecodeSupport.value[opt.value] ?? false,
    encodeSupported: webAudioEncodeSupport.value[opt.value] ?? false,
  }));
});

const isLoadingDiagnostics = computed(
  () => isLoadingTauriDiagnostics.value || isLoadingWebDiagnostics.value,
);

const hasDiagnostics = computed(() => audioCodecRows.value.length > 0);
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetAudioSettingsConfirmTitle')"
      :description="t('videoEditor.settings.resetAudioSettingsConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userAudio') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="void (isResetConfirmOpen = true)">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <label class="flex items-center justify-between gap-3 cursor-pointer select-none">
      <span class="text-sm text-ui-text">
        {{ t('videoEditor.settings.audioScrubbingHint') }}
      </span>
      <USwitch v-model="workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled" />
    </label>

    <UiFormField
      :label="t('videoEditor.settings.projectAudioDeclickTitle')"
      :help="t('videoEditor.settings.projectAudioDeclickHint')"
    >
      <UiWheelNumberInput
        :model-value="
          workspaceStore.userSettings.projectDefaults.audioDeclickDurationTicks /
          TICKS_PER_MILLISECOND
        "
        size="sm"
        :step="1"
        :min="0"
        :max="1000"
        @update:model-value="
          (value: number) =>
            (workspaceStore.userSettings.projectDefaults.audioDeclickDurationTicks = Math.round(
              Math.max(0, Math.min(1000, Number(value) || 0)) * TICKS_PER_MILLISECOND,
            ))
        "
      />
    </UiFormField>

    <!-- Native audio engine settings (Tauri only) -->
    <template v-if="isTauri && workspaceStore.inDevelopmentFeaturesEnabled">
      <div class="flex flex-col gap-4 pt-4 border-t border-ui-border-muted/50">
        <div class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.audio.nativeEngineTitle') }}
        </div>

        <UiFormField
          :label="t('videoEditor.settings.audio.bufferSizeTitle')"
          :help="t('videoEditor.settings.audio.bufferSizeHelp')"
        >
          <UiSelect
            v-model="workspaceStore.userSettings.audioEngine.bufferSize"
            size="sm"
            :items="[
              { label: t('common.default'), value: 'default' },
              { label: '64', value: 64 },
              { label: '128', value: 128 },
              { label: '256', value: 256 },
              { label: '512', value: 512 },
              { label: '1024', value: 1024 },
              { label: '2048', value: 2048 },
              { label: '4096', value: 4096 },
            ]"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.audio.backendTitle')"
          :help="t('videoEditor.settings.audio.backendHelp')"
        >
          <UiSelect
            v-model="workspaceStore.userSettings.audioEngine.backend"
            size="sm"
            :items="[
              { label: t('common.default'), value: 'default' },
              { label: 'ALSA', value: 'alsa' },
              { label: 'PulseAudio', value: 'pulseaudio' },
              { label: 'JACK', value: 'jack' },
              { label: 'WASAPI', value: 'wasapi' },
              { label: 'CoreAudio', value: 'coreaudio' },
            ]"
          />
        </UiFormField>
      </div>
    </template>

    <!-- Diagnostics section -->
    <div class="flex flex-col gap-3 pt-4 border-t border-ui-border-muted/50">
      <div class="text-sm font-medium text-ui-text-muted">
        {{
          isTauri
            ? t('videoEditor.settings.audio.tauriDiagnosticsHeader')
            : t('videoEditor.settings.audio.accelerationDiagnostics')
        }}
      </div>
      <div class="text-sm text-ui-text-muted">
        {{
          isTauri
            ? t('videoEditor.settings.audio.ffmpegDiagnosticsHelp')
            : t('videoEditor.settings.audio.accelerationDiagnosticsHelp')
        }}
      </div>

      <div v-if="isLoadingDiagnostics" class="text-sm text-ui-text-muted">
        {{ t('videoEditor.settings.audio.loadingDiagnostics') }}
      </div>

      <div v-else-if="!hasDiagnostics" class="text-sm text-ui-text-muted">
        {{ t('videoEditor.settings.audio.unavailableDiagnostics') }}
      </div>

      <div v-else class="overflow-hidden rounded-lg border border-ui-border-muted bg-ui-bg/40">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b border-ui-border-muted text-ui-text-muted">
              <th class="text-left font-medium px-3 py-2">
                {{ t('videoEditor.settings.audio.codecColumn') }}
              </th>
              <th class="text-center font-medium px-3 py-2 w-24">
                {{ t('videoEditor.settings.audio.decoderColumn') }}
              </th>
              <th class="text-center font-medium px-3 py-2 w-24">
                {{ t('videoEditor.settings.audio.encoderColumn') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ui-border-muted/50">
            <tr v-for="codec in audioCodecRows" :key="codec.label">
              <td class="px-3 py-2 text-ui-text">{{ codec.label }}</td>
              <td class="px-3 py-2 text-center">
                <UIcon
                  :name="
                    codec.decodeSupported
                      ? 'i-heroicons-check-circle-solid'
                      : 'i-heroicons-x-circle-solid'
                  "
                  :class="['size-4', codec.decodeSupported ? 'text-green-500' : 'text-red-500/50']"
                  :title="codec.decodeSupported ? t('common.yes') : t('common.no')"
                />
              </td>
              <td class="px-3 py-2 text-center">
                <UIcon
                  :name="
                    codec.encodeSupported
                      ? 'i-heroicons-check-circle-solid'
                      : 'i-heroicons-x-circle-solid'
                  "
                  :class="['size-4', codec.encodeSupported ? 'text-green-500' : 'text-red-500/50']"
                  :title="codec.encodeSupported ? t('common.yes') : t('common.no')"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
