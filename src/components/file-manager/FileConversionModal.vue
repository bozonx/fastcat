<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import { storeToRefs } from 'pinia';
import { useFileConversionStore } from '~/stores/file-conversion.store';

const { t } = useI18n();
const toast = useToast();

const fileConversionStore = useFileConversionStore();

const {
  isModalOpen,
  targetEntry,
  mediaType,

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
} = storeToRefs(fileConversionStore);

const { cancelConversion } = fileConversionStore;

function startConversion() {
  fileConversionStore.startConversion(t, toast);
}

const isOpen = computed({
  get: () => isModalOpen.value,
  set: (value) => {
    isModalOpen.value = value;
  },
});


const audioFormatOptions: readonly { value: 'opus' | 'aac'; label: string }[] = [
  { value: 'opus', label: 'OPUS' },
  { value: 'aac', label: 'AAC' },
];

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
  return t('videoEditor.fileManager.convert.title', 'Convert File');
});
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.export.convertFile', { file: fileName })"
    class="max-w-3xl"
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

      <template v-if="mediaType === 'video'">
        <div class="space-y-4">
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
          />

          <VideoEncodingForm
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
            :show-metadata="false"
            :show-presets="true"
            :has-audio="true"
            :hide-audio-bitrate="true"
            :show-audio-advanced="true"
            :original-audio-sample-rate="originalAudioSampleRate"
            :allow-original-audio-sample-rate="true"
          />
        </div>
      </template>

      <template v-else-if="mediaType === 'audio'">
        <div class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.export.outputFormat', 'Output format') }}
            </label>
            <UiAppButtonGroup
              v-model="audioOnlyFormat"
              :options="audioFormatOptions as any"
            />
          </div>

          <FileConversionAudioSettings
            v-model:audio-bitrate-kbps="audioOnlyBitrateKbps"
            v-model:audio-channels="audioChannels"
            v-model:audio-sample-rate="audioSampleRate"
            v-model:audio-reverse="audioReverse"
            :show-reverse="true"
            :original-sample-rate="originalAudioSampleRate"
            :allow-original-sample-rate="true"
          />
        </div>
      </template>

      <template v-else-if="mediaType === 'image'">
        <div class="space-y-4">
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
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">W</label>
              <WheelNumberInput
                :model-value="imageWidth"
                :min="1"
                :step="2"
                @update:model-value="onImageWidthChange"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">H</label>
              <WheelNumberInput
                :model-value="imageHeight"
                :min="1"
                :step="2"
                @update:model-value="onImageHeightChange"
              />
            </div>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3 mt-4">
        <UButton variant="ghost" color="neutral" @click="isOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" @click="startConversion">
          {{ t('videoEditor.export.convert', 'Convert') }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
