<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const props = defineProps<{
  isActive: boolean;
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const toast = useToast();

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mkv', label: 'MKV (AV1)' },
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
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

onMounted(() => {
  loadCodecSupport();
});

watch(
  () => props.isActive,
  (isActive) => {
    if (!isActive) return;
    const selected = workspaceStore.userSettings.exportDefaults.encoding.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      toast.add({
        title: t('videoEditor.settings.codecUnsupportedTitle', 'Unsupported codec'),
        description: t(
          'videoEditor.settings.codecUnsupportedDesc',
          'Selected video codec is not supported by your browser. Please choose another codec.',
        ),
        color: 'warning',
        icon: 'i-heroicons-exclamation-triangle',
      });
    }
  },
  { immediate: true },
);

function resetDefaults() {
  workspaceStore.userSettings.exportDefaults.encoding = {
    ...DEFAULT_USER_SETTINGS.exportDefaults.encoding,
  };
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userExport', 'Export defaults') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <MediaEncodingSettings
      v-model:output-format="workspaceStore.userSettings.exportDefaults.encoding.format"
      v-model:video-codec="workspaceStore.userSettings.exportDefaults.encoding.videoCodec"
      v-model:bitrate-mbps="workspaceStore.userSettings.exportDefaults.encoding.bitrateMbps"
      v-model:exclude-audio="workspaceStore.userSettings.exportDefaults.encoding.excludeAudio"
      v-model:audio-codec="workspaceStore.userSettings.exportDefaults.encoding.audioCodec"
      v-model:audio-bitrate-kbps="
        workspaceStore.userSettings.exportDefaults.encoding.audioBitrateKbps
      "
      v-model:audio-sample-rate="workspaceStore.userSettings.exportDefaults.encoding.audioSampleRate"
      v-model:bitrate-mode="workspaceStore.userSettings.exportDefaults.encoding.bitrateMode"
      v-model:keyframe-interval-sec="
        workspaceStore.userSettings.exportDefaults.encoding.keyframeIntervalSec
      "
      v-model:export-alpha="workspaceStore.userSettings.exportDefaults.encoding.exportAlpha"
      :show-audio-advanced="true"
      :disabled="false"
      :show-metadata="false"
      :has-audio="true"
      :is-loading-codec-support="isLoadingCodecSupport"
      :format-options="formatOptions"
      :video-codec-options="videoCodecOptions"
    />

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
