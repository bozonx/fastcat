<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';

const { t } = useI18n();

const {
  isModalOpen,
  targetEntry,
  mediaType,
  isConverting,
  conversionProgress,
  conversionError,
  conversionPhase,
  
  videoFormat,
  videoCodec,
  videoBitrateMbps,
  excludeAudio,
  audioCodec,
  audioBitrateKbps,
  bitrateMode,
  keyframeIntervalSec,
  videoWidth,
  videoHeight,
  videoFps,
  resolutionFormat,
  orientation,
  aspectRatio,
  isCustomResolution,

  audioOnlyFormat,
  audioOnlyCodec,
  audioOnlyBitrateKbps,
  audioChannels,
  audioSampleRate,
  audioReverse,
  originalAudioSampleRate,

  imageQuality,
  imageWidth,
  imageHeight,
  isImageResolutionLinked,
  imageAspectRatio,

  startConversion,
  cancelConversion
} = useFileConversion();

const isOpen = computed({
  get: () => isModalOpen.value,
  set: (value) => {
    isModalOpen.value = value;
  },
});

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mkv', label: 'MKV (AV1)' },
];

const audioFormatOptions: readonly { value: 'opus' | 'aac'; label: string }[] = [
  { value: 'opus', label: 'OPUS' },
  { value: 'aac', label: 'AAC' },
];

const audioCodecOptions = [
  { value: 'aac', label: t('videoEditor.export.codec.aac', 'AAC') },
  { value: 'opus', label: t('videoEditor.export.codec.opus', 'Opus') },
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

const getPhaseLabel = computed(() => {
  if (conversionPhase.value === 'encoding')
    return t('videoEditor.export.phaseEncoding', 'Encoding');
  if (conversionPhase.value === 'saving') return t('videoEditor.export.phaseSaving', 'Saving');
  return '';
});

const fileName = computed(() => targetEntry.value?.name ?? '');

const outputFileName = computed(() => {
  const baseName = fileName.value.replace(/\.[^.]+$/, '');
  if (mediaType.value === 'video') {
    return `${baseName}_converted.${videoFormat.value}`;
  }
  if (mediaType.value === 'audio') {
    const ext = audioOnlyFormat.value;
    return `${baseName}_converted.${ext}`;
  }
  if (mediaType.value === 'image') {
    return `${baseName}_converted.webp`;
  }
  return fileName.value;
});

watch(audioOnlyFormat, (nextFormat) => {
  audioOnlyCodec.value = nextFormat;
});

function clampPositiveInt(value: number) {
  const v = Math.round(Number(value) || 0);
  return Math.max(1, v);
}

function onImageWidthChange(val: number) {
  imageWidth.value = val;
  if (isImageResolutionLinked.value && imageAspectRatio.value) {
    imageHeight.value = clampPositiveInt(val / imageAspectRatio.value);
  }
}

function onImageHeightChange(val: number) {
  imageHeight.value = val;
  if (isImageResolutionLinked.value && imageAspectRatio.value) {
    imageWidth.value = clampPositiveInt(val * imageAspectRatio.value);
  }
}

const modalTitle = computed(() => {
  return isConverting.value ? '' : t('videoEditor.fileManager.convert.title', 'Convert File');
});
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.export.convertFile', { file: fileName })"
    class="max-w-3xl"
    :prevent-close="isConverting"
  >
    <div class="flex flex-col gap-6">
      <template v-if="mediaType === 'video'">
        {{ t('videoEditor.fileManager.convert.targetFile', 'Converting:') }}
        <span class="font-mono text-ui-text">{{ fileName }}</span>
      </template>

      <div class="text-sm text-ui-text-muted">
        {{ t('videoEditor.fileManager.convert.outputFile', 'Output:') }}
        <span class="font-mono text-ui-text">{{ outputFileName }}</span>
      </div>

      <template v-if="isConverting">
        <div class="p-4 bg-ui-bg-accent/30 rounded-lg border border-ui-border flex flex-col gap-2">
          <div class="text-xs text-ui-text-muted font-medium mb-1">
            {{ t('videoEditor.fileManager.convert.parameters', 'Conversion Parameters') }}
          </div>

          <template v-if="mediaType === 'video'">
            <div class="text-sm">
              <span class="text-ui-text-muted">Resolution:</span> {{ videoWidth }}x{{ videoHeight }}
            </div>
            <div class="text-sm"><span class="text-ui-text-muted">FPS:</span> {{ videoFps }}</div>
            <div class="text-sm">
              <span class="text-ui-text-muted">Video:</span> {{ videoFormat.toUpperCase() }} /
              {{ videoCodec }} ({{ videoBitrateMbps }} Mbps)
            </div>
            <div class="text-sm">
              <span class="text-ui-text-muted">Audio:</span>
              {{
                excludeAudio
                  ? 'None'
                  : `${audioCodec.toUpperCase()} (${audioBitrateKbps} Kbps, ${audioChannels}, ${audioSampleRate === 0 && originalAudioSampleRate ? originalAudioSampleRate : audioSampleRate || 'Original'} Hz)`
              }}
            </div>
          </template>

          <template v-else-if="mediaType === 'audio'">
            <div class="text-sm">
              <span class="text-ui-text-muted">Format:</span> {{ audioOnlyFormat.toUpperCase() }}
            </div>
            <div class="text-sm">
              <span class="text-ui-text-muted">Audio:</span> {{ audioOnlyBitrateKbps }} Kbps,
              {{ audioChannels }},
              {{
                audioSampleRate === 0 && originalAudioSampleRate
                  ? originalAudioSampleRate
                  : audioSampleRate || 'Original'
              }}
              Hz
            </div>
          </template>

          <template v-else-if="mediaType === 'image'">
            <div class="text-sm"><span class="text-ui-text-muted">Format:</span> WebP</div>
            <div class="text-sm">
              <span class="text-ui-text-muted">Resolution:</span> {{ imageWidth }}x{{ imageHeight }}
            </div>
            <div class="text-sm">
              <span class="text-ui-text-muted">Quality:</span> {{ imageQuality }}
            </div>
          </template>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex justify-between text-xs text-ui-text-muted">
            <span class="font-medium">{{ getPhaseLabel }}</span>
            <span class="font-mono">{{ Math.round(conversionProgress * 100) }}%</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="mediaType === 'video'" class="space-y-4">
          <MediaResolutionSettings
            v-model:is-custom-resolution="isCustomResolution"
            v-model:width="videoWidth"
            v-model:height="videoHeight"
            v-model:fps="videoFps"
            v-model:resolution-format="resolutionFormat"
            v-model:orientation="orientation"
            v-model:aspect-ratio="aspectRatio"
            :show-audio-settings="false"
            :disable-aspect-ratio="true"
            :disabled="isConverting"
          />

          <MediaEncodingSettings
            v-model:output-format="videoFormat"
            v-model:video-codec="videoCodec"
            v-model:bitrate-mbps="videoBitrateMbps"
            v-model:exclude-audio="excludeAudio"
            v-model:audio-codec="audioCodec"
            v-model:audio-bitrate-kbps="audioBitrateKbps"
            v-model:audio-channels="audioChannels"
            v-model:audio-sample-rate="audioSampleRate"
            v-model:bitrate-mode="bitrateMode"
            v-model:keyframe-interval-sec="keyframeIntervalSec"
            :disabled="isConverting"
            :show-metadata="false"
            :has-audio="true"
            :hide-audio-bitrate="true"
            :show-audio-advanced="true"
            :original-audio-sample-rate="originalAudioSampleRate"
            :allow-original-audio-sample-rate="true"
            :is-loading-codec-support="isLoadingCodecSupport"
            :format-options="formatOptions"
            :video-codec-options="videoCodecOptions"
          />
        </div>

        <div v-if="mediaType === 'audio'" class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.export.outputFormat', 'Output format') }}
            </label>
            <UiAppButtonGroup
              v-model="audioOnlyFormat"
              :options="audioFormatOptions as any"
              :disabled="isConverting"
            />
          </div>

          <FileConversionAudioSettings
            v-model:audio-bitrate-kbps="audioOnlyBitrateKbps"
            v-model:audio-channels="audioChannels"
            v-model:audio-sample-rate="audioSampleRate"
            v-model:audio-reverse="audioReverse"
            :original-sample-rate="originalAudioSampleRate"
            :allow-original-sample-rate="true"
            :disabled="isConverting"
          />
        </div>

        <div v-if="mediaType === 'image'" class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.fileManager.convert.imageFormat', 'Format') }}
            </label>
            <div class="text-sm font-medium text-ui-text">WebP</div>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.fileManager.convert.imageQuality', 'Quality (0-100)') }}
            </label>
            <WheelNumberInput
              v-model="imageQuality"
              :min="1"
              :max="100"
              :step="1"
              :disabled="isConverting"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">W</label>
              <WheelNumberInput
                :model-value="imageWidth"
                :min="1"
                :step="2"
                :disabled="isConverting"
                @update:model-value="onImageWidthChange"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">H</label>
              <WheelNumberInput
                :model-value="imageHeight"
                :min="1"
                :step="2"
                :disabled="isConverting"
                @update:model-value="onImageHeightChange"
              />
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="conversionError"
        class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
      >
        {{ conversionError }}
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3 mt-4">
        <template v-if="!isConverting">
          <UButton variant="ghost" color="neutral" @click="isOpen = false">
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
          <UButton color="primary" @click="startConversion">
            {{ t('videoEditor.export.convert', 'Convert') }}
          </UButton>
        </template>
        <template v-else>
          <div v-if="conversionProgress > 0" class="flex-1 flex items-center gap-4">
            <div class="flex-1 h-2 bg-ui-bg-muted rounded-full overflow-hidden">
              <div
                class="h-full bg-primary-500 transition-all duration-200"
                :style="{ width: `${conversionProgress * 100}%` }"
              />
            </div>
            <span class="text-sm font-medium">{{ Math.round(conversionProgress * 100) }}%</span>
            <span class="text-sm text-ui-text-muted">{{ getPhaseLabel }}</span>
          </div>
          <UButton variant="ghost" color="error" @click="cancelConversion">
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
        </template>
      </div>
    </template>
  </AppModal>
</template>
