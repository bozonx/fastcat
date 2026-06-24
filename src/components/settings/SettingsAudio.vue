<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import { getPlatformCapabilities } from '~/utils/capabilities';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import { createDevLogger } from '~/utils/dev-logger';

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

const webAudioSupport = ref<Record<string, boolean>>({});
const isLoadingWebDiagnostics = ref(false);

const isAudioEncoderAvailable = computed(() => {
  return (
    typeof globalThis !== 'undefined' &&
    !!(globalThis as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder
      ?.isConfigSupported
  );
});

const statusToneClasses = {
  danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  neutral: 'border-ui-border-muted bg-ui-bg-muted/50 text-ui-text',
  success: 'border-green-500/30 bg-green-500/10 text-green-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

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
    const { checkAudioCodecSupport, BASE_AUDIO_CODEC_OPTIONS } = await import('~/utils/webcodecs');
    webAudioSupport.value = await checkAudioCodecSupport(BASE_AUDIO_CODEC_OPTIONS);
  } catch (err) {
    log.error('Failed to load Web WebCodecs diagnostics:', err);
  } finally {
    isLoadingWebDiagnostics.value = false;
  }
}

function resetDefaults() {
  workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs =
    DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs;
  workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled =
    DEFAULT_USER_SETTINGS.projectDefaults.audioScrubbingEnabled;
  workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve =
    DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve;
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
    experimentalFeatures: workspaceStore.userSettings.experimentalFeatures,
    bufferSize: workspaceStore.userSettings.audioEngine.bufferSize,
    backend: workspaceStore.userSettings.audioEngine.backend,
  }),
  async ({ experimentalFeatures, bufferSize, backend }) => {
    if (!isTauri.value) return;
    try {
      const settings: import('~/composables/monitor/native-monitor-ipc').MonitorAudioSettingsInput =
        experimentalFeatures
          ? { bufferSize: bufferSize as 'default' | number, backend: backend as 'default' | string }
          : { bufferSize: 'default', backend: 'default' };
      await nativeMonitorIpc.setAudioSettings(settings);
    } catch (err) {
      log.error('Failed to update audio engine settings:', err);
    }
  },
  { deep: true },
);

const tauriAudioCodecs = computed(() => {
  return tauriDiagnostics.value?.codecs.filter((c) => ['aac', 'opus'].includes(c.key)) || [];
});

const webAudioCodecs = computed(() => {
  return [
    { label: 'AAC', supported: webAudioSupport.value['aac'] ?? false },
    { label: 'MP3', supported: webAudioSupport.value['mp3'] ?? false },
    { label: 'Opus', supported: webAudioSupport.value['opus'] ?? false },
    { label: 'Vorbis', supported: webAudioSupport.value['vorbis'] ?? false },
    { label: 'ALAC', supported: webAudioSupport.value['alac'] ?? false },
  ];
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetAudioSettingsConfirmTitle')"
      :description="
        t('videoEditor.settings.resetAudioSettingsConfirmDesc')
      "
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
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled" />
      <span class="text-sm text-ui-text">
        {{ t('videoEditor.settings.audioScrubbingHint') }}
      </span>
    </label>

    <UiFormField
      :label="t('videoEditor.settings.defaultAudioFadeCurveTitle')"
      :help="
        t('videoEditor.settings.defaultAudioFadeCurveHint')
      "
    >
      <UiButtonGroup
        v-model="workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve"
        :options="[
          {
            label: t('fastcat.clip.audioFade.curve.logarithmic'),
            value: 'logarithmic',
          },
          { label: t('fastcat.clip.audioFade.curve.linear'), value: 'linear' },
        ]"
      />
    </UiFormField>

    <UiFormField
      :label="t('videoEditor.settings.projectAudioDeclickTitle')"
      :help="
        t('videoEditor.settings.projectAudioDeclickHint')
      "
    >
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs / 1000"
        size="sm"
        :step="1"
        :min="0"
        :max="1000"
        @update:model-value="
          (value: number) =>
            (workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs = Math.round(
              Math.max(0, Math.min(1000, Number(value) || 0)) * 1000,
            ))
        "
      />
    </UiFormField>

    <!-- Native audio engine settings (Tauri only) -->
    <template v-if="isTauri && workspaceStore.userSettings.experimentalFeatures">
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

      <!-- Web Diagnostics -->
      <template v-if="!isTauri">
        <div
          class="rounded-lg border border-ui-border-muted bg-ui-bg-muted/30 p-4 flex flex-col gap-2"
        >
          <div
            class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium"
            :class="isAudioEncoderAvailable ? statusToneClasses.success : statusToneClasses.danger"
          >
            {{ isAudioEncoderAvailable ? 'AudioEncoder Available' : 'AudioEncoder Unavailable' }}
          </div>
          <div class="text-sm text-ui-text-muted">
            {{ t('videoEditor.settings.audio.accelerationDiagnosticsHelp') }}
          </div>
        </div>

        <div v-if="isLoadingWebDiagnostics" class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.audio.loadingDiagnostics') }}
        </div>

        <div v-else class="flex flex-col gap-4">
          <div
            class="rounded-lg border border-ui-border-muted p-4 flex flex-col gap-3 bg-ui-bg-muted/10"
          >
            <div class="text-sm font-medium text-ui-text border-b border-ui-border-muted/50 pb-2">
              Browser Audio Codec Support
            </div>
            <div
              class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30"
            >
              <div
                v-for="codec in webAudioCodecs"
                :key="codec.label"
                class="flex items-center justify-between px-3 py-2.5"
              >
                <span class="text-sm text-ui-text-muted">{{ codec.label }}</span>
                <span
                  :class="[
                    'text-xs font-medium px-2 py-0.5 rounded-full border',
                    codec.supported
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20',
                  ]"
                >
                  {{ codec.supported ? 'Supported' : 'Unsupported' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Tauri Diagnostics -->
      <template v-else>
        <div
          v-if="tauriDiagnostics"
          class="rounded-lg border border-ui-border-muted bg-ui-bg-muted/30 p-4 flex flex-col gap-2"
        >
          <div
            class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium"
            :class="
              tauriDiagnostics.ffmpegAvailable
                ? statusToneClasses.success
                : statusToneClasses.danger
            "
          >
            {{
              tauriDiagnostics.ffmpegAvailable
                ? t('videoEditor.settings.audio.ffmpegAvailable')
                : t('videoEditor.settings.audio.unavailableDiagnostics')
            }}
          </div>
          <div class="text-sm text-ui-text-muted">
            {{ t('videoEditor.settings.audio.ffmpegDiagnosticsHelp') }}
          </div>
        </div>

        <div v-else-if="isLoadingTauriDiagnostics" class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.audio.loadingDiagnostics') }}
        </div>

        <div v-else class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.audio.unavailableDiagnostics') }}
        </div>

        <div v-if="tauriDiagnostics" class="flex flex-col gap-4">
          <!-- FFmpeg & FFprobe status -->
          <div
            class="rounded-lg border border-ui-border-muted p-4 flex flex-col gap-3 bg-ui-bg-muted/10"
          >
            <div class="text-sm font-medium text-ui-text">
              {{ t('videoEditor.settings.audio.ffmpegDiagnostics') }}
            </div>

            <div
              class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30"
            >
              <div class="flex items-start justify-between gap-4 px-3 py-2.5">
                <span class="text-sm text-ui-text-muted">{{
                  t('videoEditor.settings.audio.ffmpegAvailable')
                }}</span>
                <span
                  :class="[
                    'text-sm font-medium',
                    tauriDiagnostics.ffmpegAvailable ? 'text-green-400' : 'text-red-400',
                  ]"
                >
                  {{
                    tauriDiagnostics.ffmpegAvailable
                      ? tauriDiagnostics.ffmpegVersion
                      : t('common.no')
                  }}
                </span>
              </div>
              <div class="flex items-start justify-between gap-4 px-3 py-2.5">
                <span class="text-sm text-ui-text-muted">{{
                  t('videoEditor.settings.audio.ffprobeAvailable')
                }}</span>
                <span
                  :class="[
                    'text-sm font-medium',
                    tauriDiagnostics.ffprobeAvailable ? 'text-green-400' : 'text-red-400',
                  ]"
                >
                  {{
                    tauriDiagnostics.ffprobeAvailable
                      ? tauriDiagnostics.ffprobeVersion
                      : t('common.no')
                  }}
                </span>
              </div>
            </div>
          </div>

          <!-- Codecs grid -->
          <div
            v-for="codec in tauriAudioCodecs"
            :key="codec.key"
            class="rounded-lg border border-ui-border-muted p-4 flex flex-col gap-3 bg-ui-bg-muted/10"
          >
            <div class="text-sm font-medium text-ui-text border-b border-ui-border-muted/50 pb-2">
              {{ codec.label }}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Decoders -->
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-ui-text-muted px-1">
                  {{ t('videoEditor.settings.audio.codecDecoderSupport') }}
                </div>
                <div
                  class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30"
                >
                  <div
                    v-for="decoder in codec.decoders"
                    :key="decoder.name"
                    class="flex items-center justify-between px-3 py-2"
                  >
                    <span class="text-xs text-ui-text-muted">{{ decoder.label }}</span>
                    <span
                      :class="[
                        'text-xs font-medium px-2 py-0.5 rounded-full border',
                        decoder.supported
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20',
                      ]"
                    >
                      {{ decoder.supported ? 'Supported' : 'Unsupported' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Encoders -->
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-ui-text-muted px-1">
                  {{ t('videoEditor.settings.audio.codecEncoderSupport') }}
                </div>
                <div
                  class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30"
                >
                  <div
                    v-for="encoder in codec.encoders"
                    :key="encoder.name"
                    class="flex items-center justify-between px-3 py-2"
                  >
                    <span class="text-xs text-ui-text-muted">{{ encoder.label }}</span>
                    <span
                      :class="[
                        'text-xs font-medium px-2 py-0.5 rounded-full border',
                        encoder.supported
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20',
                      ]"
                    >
                      {{ encoder.supported ? 'Supported' : 'Unsupported' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
