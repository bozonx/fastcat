<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';

const { t } = useI18n();
const projectStore = useProjectStore();

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM (VP9 + Opus)' },
  { value: 'mkv', label: 'MKV (AV1 + Opus)' },
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
    const selected = projectStore.projectSettings.export.encoding.videoCodec;
    if (videoCodecSupport.value[selected] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find(
        (opt) => videoCodecSupport.value[opt.value],
      );
      if (firstSupported)
        projectStore.projectSettings.export.encoding.videoCodec = firstSupported.value;
    }
  } finally {
    isLoadingCodecSupport.value = false;
  }
}

// Load on mount
loadCodecSupport();
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0 min-w-0">
    <div class="flex flex-col gap-6 px-3 py-3">
      <div class="text-xs text-gray-500">
        {{
          t('videoEditor.projectSettings.note', 'Settings are saved to .gran/project.settings.json')
        }}
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-sm font-medium text-gray-200">
          {{ t('videoEditor.projectSettings.export', 'Export') }}
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="t('videoEditor.projectSettings.exportWidth', 'Width')">
            <UInput
              v-model.number="projectStore.projectSettings.export.width"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('videoEditor.projectSettings.exportHeight', 'Height')">
            <UInput
              v-model.number="projectStore.projectSettings.export.height"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField :label="t('videoEditor.projectSettings.exportFps', 'FPS')">
          <UInput
            v-model.number="projectStore.projectSettings.export.fps"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="w-full"
          />
        </UFormField>

        <MediaEncodingSettings
          v-model:output-format="projectStore.projectSettings.export.encoding.format"
          v-model:video-codec="projectStore.projectSettings.export.encoding.videoCodec"
          v-model:bitrate-mbps="projectStore.projectSettings.export.encoding.bitrateMbps"
          v-model:exclude-audio="projectStore.projectSettings.export.encoding.excludeAudio"
          v-model:audio-bitrate-kbps="projectStore.projectSettings.export.encoding.audioBitrateKbps"
          :disabled="false"
          :has-audio="true"
          :is-loading-codec-support="isLoadingCodecSupport"
          :format-options="formatOptions"
          :video-codec-options="videoCodecOptions"
          audio-codec-label="AAC"
        />
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-sm font-medium text-gray-200">
          {{ t('videoEditor.projectSettings.proxy', 'Proxy') }}
        </div>

        <UFormField :label="t('videoEditor.projectSettings.proxyHeight', 'Height')">
          <UInput
            v-model.number="projectStore.projectSettings.proxy.height"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="w-full"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
