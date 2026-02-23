<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import AppModal from '~/components/ui/AppModal.vue';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

type SettingsSection = 'user.general' | 'user.optimization' | 'user.export' | 'workspace.storage';

const activeSection = ref<SettingsSection>('user.general');

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
];

const videoCodecSupport = ref<Record<string, boolean>>({});
const isLoadingCodecSupport = ref(false);

const videoCodecOptions = computed(() =>
  resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
);

async function loadCodecSupport() {
  if (isLoadingCodecSupport.value) return;
  isLoadingCodecSupport.value = true;
  try {
    videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
    const selected = workspaceStore.userSettings.exportDefaults.encoding.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find((opt) => videoCodecSupport.value[opt.value]);
      if (firstSupported) workspaceStore.userSettings.exportDefaults.encoding.videoCodec = firstSupported.value;
    }
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

loadCodecSupport();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const proxyLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.proxyStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.proxyStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});

const cacheLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.cacheStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.cacheStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});

const thumbnailsLimitGb = computed({
  get: () =>
    Math.round(workspaceStore.workspaceSettings.thumbnailsStorageLimitBytes / (1024 * 1024 * 1024)),
  set: (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    workspaceStore.workspaceSettings.thumbnailsStorageLimitBytes = Math.round(n * 1024 * 1024 * 1024);
  },
});
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
      <div
        class="w-56 shrink-0 p-6 bg-gray-50/50 dark:bg-gray-800/20 border-r border-gray-100 dark:border-gray-800 overflow-y-auto"
      >
        <div class="flex flex-col gap-6">
          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
              :label="t('videoEditor.settings.userOptimization', 'Optimization')"
              :disabled="activeSection === 'user.optimization'"
              @click="activeSection = 'user.optimization'"
            />
            <UButton
              variant="ghost"
              color="neutral"
              class="justify-start"
              :label="t('videoEditor.settings.userExport', 'Export')"
              :disabled="activeSection === 'user.export'"
              @click="activeSection = 'user.export'"
            />
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">
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
        <div v-if="activeSection === 'user.general'" class="flex flex-col gap-4">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-200">
            {{ t('videoEditor.settings.userGeneral', 'General') }}
          </div>

          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="workspaceStore.userSettings.openLastProjectOnStart" />
            <span class="text-sm text-gray-700 dark:text-gray-200">
              {{ t('videoEditor.settings.openLastProjectOnStart', 'Open last project on start') }}
            </span>
          </label>

          <div class="text-xs text-gray-500">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else-if="activeSection === 'user.optimization'" class="flex flex-col gap-6">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-200">
            {{ t('videoEditor.settings.userOptimization', 'Optimization') }}
          </div>

          <div class="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 rounded text-sm">
            {{ t('videoEditor.settings.proxyInfo', 'Proxy files are used to improve playback performance in the editor. They are generated in WebM format with VP9 video codec and Opus audio codec.') }}
          </div>

          <UFormField :label="t('videoEditor.settings.proxyResolution', 'Proxy resolution')">
            <USelectMenu
              v-model="workspaceStore.userSettings.optimization.proxyResolution"
              :items="[
                { label: '360p', value: '360p' },
                { label: '480p', value: '480p' },
                { label: '720p', value: '720p' },
                { label: '1080p', value: '1080p' }
              ]"
              value-key="value"
              label-key="label"
              class="w-full"
              @update:model-value="(v: any) => workspaceStore.userSettings.optimization.proxyResolution = v?.value ?? v"
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.proxyVideoBitrate', 'Video bitrate (Mbps)')"
            :help="t('videoEditor.settings.proxyVideoBitrateHelp', 'Higher bitrate means better quality but larger file size')"
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

          <UFormField
            :label="t('videoEditor.settings.proxyAudioBitrate', 'Audio bitrate (kbps)')"
          >
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

          <label class="flex items-center gap-3 cursor-pointer">
            <UCheckbox v-model="workspaceStore.userSettings.optimization.proxyCopyOpusAudio" />
            <span class="text-sm text-gray-700 dark:text-gray-200">
              {{ t('videoEditor.settings.proxyCopyOpusAudio', 'Copy Opus audio directly without re-encoding') }}
            </span>
          </label>

          <div class="text-xs text-gray-500">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else-if="activeSection === 'user.export'" class="flex flex-col gap-6">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-200">
            {{ t('videoEditor.settings.userExport', 'Export') }}
          </div>

          <MediaResolutionSettings
            v-model:width="workspaceStore.userSettings.exportDefaults.width"
            v-model:height="workspaceStore.userSettings.exportDefaults.height"
            v-model:fps="workspaceStore.userSettings.exportDefaults.fps"
            v-model:resolution-format="workspaceStore.userSettings.exportDefaults.resolutionFormat"
            v-model:orientation="workspaceStore.userSettings.exportDefaults.orientation"
            v-model:aspect-ratio="workspaceStore.userSettings.exportDefaults.aspectRatio"
            v-model:is-custom-resolution="workspaceStore.userSettings.exportDefaults.isCustomResolution"
            :disabled="false"
          />

          <MediaEncodingSettings
            v-model:output-format="workspaceStore.userSettings.exportDefaults.encoding.format"
            v-model:video-codec="workspaceStore.userSettings.exportDefaults.encoding.videoCodec"
            v-model:bitrate-mbps="workspaceStore.userSettings.exportDefaults.encoding.bitrateMbps"
            v-model:exclude-audio="workspaceStore.userSettings.exportDefaults.encoding.excludeAudio"
            v-model:audio-codec="workspaceStore.userSettings.exportDefaults.encoding.audioCodec"
            v-model:audio-bitrate-kbps="workspaceStore.userSettings.exportDefaults.encoding.audioBitrateKbps"
            :disabled="false"
            :has-audio="true"
            :is-loading-codec-support="isLoadingCodecSupport"
            :format-options="formatOptions"
            :video-codec-options="videoCodecOptions"
          />

          <div class="text-xs text-gray-500">
            {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
          </div>
        </div>

        <div v-else class="flex flex-col gap-4">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-200">
            {{ t('videoEditor.settings.workspaceStorage', 'Storage') }}
          </div>

          <UFormField
            :label="t('videoEditor.settings.proxyLimit', 'Proxy storage limit (GB)')"
            :help="
              t(
                'videoEditor.settings.proxyLimitHelp',
                'Total limit for all proxy files in this workspace',
              )
            "
          >
            <UInput
              v-model.number="proxyLimitGb"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.cacheLimit', 'Cache storage limit (GB)')"
            :help="
              t(
                'videoEditor.settings.cacheLimitHelp',
                'Total limit for cached data in this workspace',
              )
            "
          >
            <UInput
              v-model.number="cacheLimitGb"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('videoEditor.settings.thumbnailsLimit', 'Thumbnails storage limit (GB)')"
            :help="
              t(
                'videoEditor.settings.thumbnailsLimitHelp',
                'Total limit for generated thumbnails in this workspace',
              )
            "
          >
            <UInput
              v-model.number="thumbnailsLimitGb"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <div class="text-xs text-gray-500">
            {{ t('videoEditor.settings.workspaceSavedNote', 'Saved to .gran/workspace.settings.json') }}
          </div>
        </div>
      </div>
    </div>
  </AppModal>
</template>
