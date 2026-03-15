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
  video,
  audio,
  image,
} = storeToRefs(fileConversionStore);

const { cancelConversion, startConversion: storeStartConversion } = fileConversionStore;

onMounted(() => {
  fileConversionStore.callbacks.onSuccess = (type, bgTaskTitle) => {
    if (type === 'bgTaskAdded') {
      toast.add({
        title: t('videoEditor.fileManager.convert.bgTaskAdded', 'Conversion started in background'),
        description: bgTaskTitle,
        color: 'neutral',
      });
    } else {
      toast.add({
        title: t('videoEditor.fileManager.convert.success', 'File converted successfully'),
        color: 'success',
      });
    }
  };
  fileConversionStore.callbacks.onError = (error) => {
    toast.add({
      title: t('videoEditor.fileManager.convert.failed', 'Conversion failed to start'),
      description: error.message,
      color: 'error',
    });
  };
});

function startConversion() {
  storeStartConversion();
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
  return '';
});

const fileName = computed(() => targetEntry.value?.name ?? '');

const outputFileName = computed(() => {
  const baseName = fileName.value.replace(/\.[^.]+$/, '');
  if (mediaType.value === 'video') {
    return `${baseName}_converted.${video.value.format}`;
  }
  if (mediaType.value === 'audio') {
    const ext = audio.value.onlyFormat;
    return `${baseName}_converted.${ext}`;
  }
  if (mediaType.value === 'image') {
    return `${baseName}_converted.webp`;
  }
  return fileName.value;
});

watch(() => audio.value.onlyFormat, (nextFormat) => {
  audio.value.onlyCodec = nextFormat;
});

function clampPositiveInt(value: number) {
  const v = Math.round(Number(value) || 0);
  return Math.max(1, v);
}

function onImageWidthChange(val: number) {
  image.value.width = val;
  if (image.value.isResolutionLinked && image.value.aspectRatio) {
    image.value.height = clampPositiveInt(val / image.value.aspectRatio);
  }
}

function onImageHeightChange(val: number) {
  image.value.height = val;
  if (image.value.isResolutionLinked && image.value.aspectRatio) {
    image.value.width = clampPositiveInt(val * image.value.aspectRatio);
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
            v-model:is-custom-resolution="video.isCustomResolution"
            v-model:width="video.width"
            v-model:height="video.height"
            v-model:fps="video.fps"
            v-model:resolution-format="video.resolutionFormat"
            v-model:orientation="video.orientation"
            v-model:aspect-ratio="video.aspectRatio"
            :show-audio-settings="false"
            :disable-aspect-ratio="true"
          />

          <VideoEncodingForm
            v-model:output-format="video.format"
            v-model:video-codec="video.videoCodec"
            v-model:bitrate-mbps="video.bitrateMbps"
            v-model:exclude-audio="video.excludeAudio"
            v-model:audio-codec="video.audioCodec"
            v-model:audio-bitrate-kbps="video.audioBitrateKbps"
            v-model:audio-channels="audio.channels"
            v-model:audio-sample-rate="audio.sampleRate"
            v-model:bitrate-mode="video.bitrateMode"
            v-model:keyframe-interval-sec="video.keyframeIntervalSec"
            :show-metadata="false"
            :show-presets="true"
            :has-audio="true"
            :hide-audio-bitrate="true"
            :show-audio-advanced="true"
            :original-audio-sample-rate="audio.originalSampleRate"
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
              v-model="audio.onlyFormat"
              :options="audioFormatOptions as any"
            />
          </div>

          <FileConversionAudioSettings
            v-model:audio-bitrate-kbps="audio.onlyBitrateKbps"
            v-model:audio-channels="audio.channels"
            v-model:audio-sample-rate="audio.sampleRate"
            v-model:audio-reverse="audio.reverse"
            :show-reverse="true"
            :original-sample-rate="audio.originalSampleRate"
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
              v-model="image.quality"
              :min="1"
              :max="100"
              :step="1"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">W</label>
              <WheelNumberInput
                :model-value="image.width"
                :min="1"
                :step="2"
                @update:model-value="onImageWidthChange"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">H</label>
              <WheelNumberInput
                :model-value="image.height"
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
