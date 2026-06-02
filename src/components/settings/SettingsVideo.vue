<script setup lang="ts">
import { watch, onMounted, ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import { resolveExportPreset, resolveProjectPreset } from '~/utils/settings';
import {
  gatherVideoDiagnostics,
  type VideoDiagnosticsSnapshot,
  type VideoDiagnosticsStatus,
} from '~/utils/settings/videoDiagnostics';
import { broadcastPixiRendererPreference } from '~/utils/video-editor/worker-client';
import { isTauriRuntime } from '~/utils/runtime';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

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
const isTauri = computed(() => isTauriRuntime());

const diagnostics = ref<VideoDiagnosticsSnapshot | null>(null);
const isLoadingDiagnostics = ref(false);

const tauriDiagnostics = ref<FfmpegDiagnostics | null>(null);
const isLoadingTauriDiagnostics = ref(false);

const isResetConfirmOpen = ref(false);

const selectedProjectPreset = computed(() =>
  resolveProjectPreset(workspaceStore.userSettings.projectPresets),
);
const selectedExportPreset = computed(() =>
  resolveExportPreset(workspaceStore.userSettings.exportPresets),
);

const statusToneClasses: Record<VideoDiagnosticsStatus['tone'], string> = {
  danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  neutral: 'border-ui-border-muted bg-ui-bg-muted/50 text-ui-text',
  success: 'border-green-500/30 bg-green-500/10 text-green-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

const sectionContainerClasses: Record<VideoDiagnosticsStatus['tone'], string> = {
  danger: 'border-red-500/50 bg-red-500/10',
  neutral: 'border-ui-border-muted bg-transparent',
  success: 'border-ui-border-muted bg-transparent',
  warning: 'border-amber-500/50 bg-amber-500/10',
};

async function loadDiagnostics() {
  isLoadingDiagnostics.value = true;

  try {
    diagnostics.value = await gatherVideoDiagnostics({
      createCanvas: () =>
        document.createElement('canvas') as unknown as { getContext: (name: string) => unknown },
      probe: {
        audioBitrate: 128_000,
        audioChannels: 2,
        audioCodec: selectedExportPreset.value.audioCodec,
        audioSampleRate: selectedProjectPreset.value.sampleRate,
        framerate: selectedProjectPreset.value.fps,
        height: selectedProjectPreset.value.height,
        videoBitrate: Math.round(selectedExportPreset.value.bitrateMbps * 1_000_000),
        videoCodec: selectedExportPreset.value.videoCodec,
        width: selectedProjectPreset.value.width,
      },
    });
  } catch {
    diagnostics.value = null;
  } finally {
    isLoadingDiagnostics.value = false;
  }
}

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
    // eslint-disable-next-line no-console
    console.error('Failed to load Tauri FFmpeg diagnostics:', err);
    tauriDiagnostics.value = null;
  } finally {
    isLoadingTauriDiagnostics.value = false;
  }
}

async function syncFfmpegSettings() {
  if (!isTauri.value) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_update_ffmpeg_settings', {
      settings: {
        ffmpegPath: workspaceStore.userSettings.optimization.ffmpegPath,
        ffprobePath: workspaceStore.userSettings.optimization.ffprobePath,
        hardwareAccelerationMode: workspaceStore.userSettings.optimization.hardwareAccelerationMode,
        vaapiDevice: workspaceStore.userSettings.optimization.vaapiDevice,
        enableHardwareEncoding: workspaceStore.userSettings.optimization.enableHardwareEncoding,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to sync ffmpeg settings to backend:', err);
  }
}

onMounted(async () => {
  if (isTauri.value) {
    await loadTauriDiagnostics();
    await syncFfmpegSettings();
  } else {
    await loadDiagnostics();
  }
});

function resetDefaults() {
  workspaceStore.userSettings.optimization.videoFrameCacheMb =
    DEFAULT_USER_SETTINGS.optimization.videoFrameCacheMb;
  workspaceStore.userSettings.optimization.pixiRenderer =
    DEFAULT_USER_SETTINGS.optimization.pixiRenderer;
  workspaceStore.userSettings.optimization.ffmpegPath =
    DEFAULT_USER_SETTINGS.optimization.ffmpegPath;
  workspaceStore.userSettings.optimization.ffprobePath =
    DEFAULT_USER_SETTINGS.optimization.ffprobePath;
  workspaceStore.userSettings.optimization.hardwareAccelerationMode =
    DEFAULT_USER_SETTINGS.optimization.hardwareAccelerationMode;
  workspaceStore.userSettings.optimization.vaapiDevice =
    DEFAULT_USER_SETTINGS.optimization.vaapiDevice;
  workspaceStore.userSettings.optimization.enableHardwareEncoding =
    DEFAULT_USER_SETTINGS.optimization.enableHardwareEncoding;
  isResetConfirmOpen.value = false;
}

watch(
  () => workspaceStore.userSettings.optimization.pixiRenderer,
  async (preference) => {
    await broadcastPixiRendererPreference(preference);
  },
);

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

watch(
  () => [
    workspaceStore.userSettings.optimization.ffmpegPath,
    workspaceStore.userSettings.optimization.ffprobePath,
    workspaceStore.userSettings.optimization.hardwareAccelerationMode,
    workspaceStore.userSettings.optimization.vaapiDevice,
    workspaceStore.userSettings.optimization.enableHardwareEncoding,
  ],
  async () => {
    if (isTauri.value) {
      await syncFfmpegSettings();
    }
  },
  { deep: true },
);

const tauriVideoCodecs = computed(() => {
  return tauriDiagnostics.value?.codecs.filter(c => ['h264', 'hevc', 'vp9', 'av1'].includes(c.key)) || [];
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetVideoSettingsConfirmTitle')"
      :description="t('videoEditor.settings.resetVideoSettingsConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.video.performance') }}
      </div>
      <div class="flex items-center gap-2">
        <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
          {{ t('videoEditor.settings.resetDefaults') }}
        </UButton>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div class="text-sm font-medium text-ui-text-muted">
        {{ isTauri ? t('videoEditor.settings.video.tauriDiagnosticsHeader') : t('videoEditor.settings.video.accelerationDiagnostics') }}
      </div>

      <div class="flex flex-col gap-4">
        <!-- Web settings -->
        <template v-if="!isTauri">
          <UiFormField
            :label="t('videoEditor.settings.pixiRenderer')"
            :help="t('videoEditor.settings.pixiRendererHelp')"
          >
            <UiButtonGroup
              v-model="workspaceStore.userSettings.optimization.pixiRenderer"
              :options="[
                { label: 'WebGL', value: 'webgl' },
                { label: 'WebGPU', value: 'webgpu' },
              ]"
              class="max-w-xs"
              fluid
            />
          </UiFormField>

          <UiFormField
            :label="t('videoEditor.settings.videoFrameCacheMb')"
            :help="t('videoEditor.settings.videoFrameCacheMbHelp')"
          >
            <UiWheelNumberInput
              v-model="workspaceStore.userSettings.optimization.videoFrameCacheMb"
              :min="0"
              :max="4096"
              :step="16"
              class="max-w-xs"
            />
          </UiFormField>
        </template>

        <!-- Tauri / Desktop settings -->
        <template v-else>
          <div class="border-b border-ui-border-muted/50 pb-3 mb-2">
            <div class="text-sm font-medium text-ui-text">
              {{ t('videoEditor.settings.video.ffmpegSettings') }}
            </div>
          </div>

          <UiFormField
            :label="t('videoEditor.settings.video.hwaccelMode')"
            :help="t('videoEditor.settings.video.hwaccelModeHelp')"
          >
            <UiSelect
              v-model="workspaceStore.userSettings.optimization.hardwareAccelerationMode"
              :items="[
                { label: 'None', value: 'none' },
                { label: 'VAAPI (Intel/AMD)', value: 'vaapi' },
                { label: 'NVDEC (Nvidia)', value: 'nvdec' },
                { label: 'Auto', value: 'auto' },
              ]"
              class="max-w-xs"
              full-width
            />
          </UiFormField>

          <UiFormField
            v-if="
              workspaceStore.userSettings.optimization.hardwareAccelerationMode === 'vaapi' ||
              workspaceStore.userSettings.optimization.hardwareAccelerationMode === 'auto'
            "
            :label="t('videoEditor.settings.video.vaapiDevice')"
            :help="t('videoEditor.settings.video.vaapiDeviceHelp')"
          >
            <UiTextInput
              v-model="workspaceStore.userSettings.optimization.vaapiDevice"
              class="max-w-xs"
            />
          </UiFormField>

          <UiFormField
            :label="t('videoEditor.settings.video.enableHardwareEncoding')"
            :help="t('videoEditor.settings.video.enableHardwareEncodingHelp')"
          >
            <UCheckbox v-model="workspaceStore.userSettings.optimization.enableHardwareEncoding" />
          </UiFormField>

          <UiFormField
            :label="t('videoEditor.settings.video.ffmpegPath')"
            :help="t('videoEditor.settings.video.ffmpegPathHelp')"
          >
            <UiTextInput
              v-model="workspaceStore.userSettings.optimization.ffmpegPath"
              class="max-w-xs"
            />
          </UiFormField>

          <UiFormField
            :label="t('videoEditor.settings.video.ffprobePath')"
            :help="t('videoEditor.settings.video.ffprobePathHelp')"
          >
            <UiTextInput
              v-model="workspaceStore.userSettings.optimization.ffprobePath"
              class="max-w-xs"
            />
          </UiFormField>
        </template>
      </div>

      <!-- Web Diagnostics -->
      <template v-if="!isTauri">
        <div
          v-if="diagnostics"
          class="rounded-lg border border-ui-border-muted bg-ui-bg-muted/30 p-4 flex flex-col gap-2"
        >
          <div
            class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium"
            :class="statusToneClasses[diagnostics.summary.tone]"
          >
            {{ diagnostics.summary.label }}
          </div>
          <div class="text-sm text-ui-text-muted">
            {{ t('videoEditor.settings.video.accelerationDiagnosticsHelp') }}
          </div>
        </div>

        <div v-else-if="isLoadingDiagnostics" class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.video.loadingDiagnostics') }}
        </div>

        <div v-else class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.video.unavailableDiagnostics') }}
        </div>

        <div v-if="diagnostics" class="flex flex-col gap-4">
          <div
            v-for="section in diagnostics.sections"
            :key="section.title"
            class="rounded-lg border p-4 flex flex-col gap-3"
            :class="sectionContainerClasses[section.status.tone]"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium text-ui-text">
                  {{ section.title }}
                </div>
                <div class="text-xs text-ui-text-muted">
                  {{ section.description }}
                </div>
              </div>
              <div
                class="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium"
                :class="statusToneClasses[section.status.tone]"
              >
                {{ section.status.label }}
              </div>
            </div>

            <div
              class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30"
            >
              <div
                v-for="item in section.items"
                :key="`${section.title}-${item.label}`"
                class="flex items-start justify-between gap-4 px-3 py-2.5"
              >
                <span class="text-sm text-ui-text-muted">{{ item.label }}</span>
                <span class="text-sm text-right text-ui-text font-medium break-all">{{
                  item.value
                }}</span>
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
            :class="tauriDiagnostics.ffmpegAvailable ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-red-500/30 bg-red-500/10 text-red-200'"
          >
            {{ tauriDiagnostics.ffmpegAvailable ? t('videoEditor.settings.video.ffmpegAvailable') : t('videoEditor.settings.video.unavailableDiagnostics') }}
          </div>
          <div class="text-sm text-ui-text-muted">
            {{ t('videoEditor.settings.video.ffmpegDiagnosticsHelp') }}
          </div>
        </div>

        <div v-else-if="isLoadingTauriDiagnostics" class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.video.loadingDiagnostics') }}
        </div>

        <div v-else class="text-sm text-ui-text-muted">
          {{ t('videoEditor.settings.video.unavailableDiagnostics') }}
        </div>

        <div v-if="tauriDiagnostics" class="flex flex-col gap-4">
          <!-- FFmpeg & FFprobe status -->
          <div class="rounded-lg border border-ui-border-muted p-4 flex flex-col gap-3 bg-ui-bg-muted/10">
            <div class="text-sm font-medium text-ui-text">
              {{ t('videoEditor.settings.video.ffmpegDiagnostics') }}
            </div>
            
            <div class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30">
              <div class="flex items-start justify-between gap-4 px-3 py-2.5">
                <span class="text-sm text-ui-text-muted">{{ t('videoEditor.settings.video.ffmpegAvailable') }}</span>
                <span :class="['text-sm font-medium', tauriDiagnostics.ffmpegAvailable ? 'text-green-400' : 'text-red-400']">
                  {{ tauriDiagnostics.ffmpegAvailable ? tauriDiagnostics.ffmpegVersion : t('common.no') }}
                </span>
              </div>
              <div class="flex items-start justify-between gap-4 px-3 py-2.5">
                <span class="text-sm text-ui-text-muted">{{ t('videoEditor.settings.video.ffprobeAvailable') }}</span>
                <span :class="['text-sm font-medium', tauriDiagnostics.ffprobeAvailable ? 'text-green-400' : 'text-red-400']">
                  {{ tauriDiagnostics.ffprobeAvailable ? tauriDiagnostics.ffprobeVersion : t('common.no') }}
                </span>
              </div>
              <div class="flex items-start justify-between gap-4 px-3 py-2.5">
                <span class="text-sm text-ui-text-muted">{{ t('videoEditor.settings.video.supportedHwaccels') }}</span>
                <span class="text-sm text-right text-ui-text font-medium break-all">
                  {{ tauriDiagnostics.hwaccels.length > 0 ? tauriDiagnostics.hwaccels.join(', ') : 'None' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Codecs grid -->
          <div
            v-for="codec in tauriVideoCodecs"
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
                  {{ t('videoEditor.settings.video.codecDecoderSupport') }}
                </div>
                <div class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30">
                  <div
                    v-for="decoder in codec.decoders"
                    :key="decoder.name"
                    class="flex items-center justify-between px-3 py-2"
                  >
                    <span class="text-xs text-ui-text-muted">{{ decoder.label }}</span>
                    <span :class="['text-xs font-medium px-2 py-0.5 rounded-full border', decoder.supported ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20']">
                      {{ decoder.supported ? 'Supported' : 'Unsupported' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Encoders -->
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-ui-text-muted px-1">
                  {{ t('videoEditor.settings.video.codecEncoderSupport') }}
                </div>
                <div class="flex flex-col rounded-md border border-ui-border-muted/50 bg-ui-bg/40 divide-y divide-ui-border-muted/30">
                  <div
                    v-for="encoder in codec.encoders"
                    :key="encoder.name"
                    class="flex items-center justify-between px-3 py-2"
                  >
                    <span class="text-xs text-ui-text-muted">{{ encoder.label }}</span>
                    <span :class="['text-xs font-medium px-2 py-0.5 rounded-full border', encoder.supported ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20']">
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
