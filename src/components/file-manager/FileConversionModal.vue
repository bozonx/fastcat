<script setup lang="ts">
import { computed, watch, onMounted } from 'vue';

import UiModal from '~/components/ui/UiModal.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import { storeToRefs } from 'pinia';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { resolveAudioOnlyFileExtension } from '~/utils/conversion/helpers';

import { useExportCodecs } from '~/composables/timeline/export/core/useExportCodecs';

const { t } = useI18n();
const { isMobile } = useDevice();
const modalWrapper = computed(() => (isMobile ? UiMobileDrawer : UiModal));
const modalUi = computed(() => (isMobile ? {} : { content: 'sm:max-w-3xl' }));

const fileConversionStore = useFileConversionStore();

const {
  isModalOpen,
  isConverting,
  isExtractingMetadata,
  targetEntry,
  mediaType,
  sourceHasAudio,
  video,
  audio,
  image,
  conversionError,
  conversionWarnings,
} = storeToRefs(fileConversionStore);

const { startConversion: storeStartConversion } = fileConversionStore;

function startConversion() {
  storeStartConversion();
}

const isOpen = computed({
  get: () => isModalOpen.value,
  set: (value) => {
    isModalOpen.value = value;
  },
});

const { audioCodecSupport, loadCodecSupport } = useExportCodecs();

onMounted(() => {
  loadCodecSupport();
});

const audioFormatOptions = computed(() => [
  { value: 'aac', label: 'AAC', disabled: !audioCodecSupport.value?.aac },
  { value: 'opus', label: 'OPUS', disabled: !audioCodecSupport.value?.opus },
  { value: 'flac', label: 'FLAC', disabled: !audioCodecSupport.value?.flac },
  { value: 'pcm', label: 'PCM (WAV)', disabled: !audioCodecSupport.value?.pcm },
  { value: 'mp3', label: 'MP3', disabled: !audioCodecSupport.value?.mp3 },
]);

const fileName = computed(() => targetEntry.value?.name ?? '');

const outputFileName = computed(() => {
  const baseName = fileName.value.replace(/\.[^.]+$/, '');
  if (mediaType.value === 'video') {
    return `${baseName}_converted.${video.value.format}`;
  }
  if (mediaType.value === 'audio') {
    const ext = resolveAudioOnlyFileExtension(audio.value.onlyFormat);
    return `${baseName}_converted.${ext}`;
  }
  if (mediaType.value === 'image') {
    return `${baseName}_converted.webp`;
  }
  return fileName.value;
});

watch(
  sourceHasAudio,
  (hasAudio) => {
    if (!hasAudio && mediaType.value === 'video') {
      video.value.excludeAudio = true;
    }
  },
  { immediate: true },
);

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

const isFormValid = computed(() => {
  if (mediaType.value === 'video') {
    if (video.value.bitrateMbps <= 0) return false;
    if (video.value.width <= 0 || video.value.height <= 0) return false;
    if (video.value.fps <= 0) return false;
    if (video.value.keyframeIntervalSec <= 0) return false;
    if (!video.value.excludeAudio && video.value.audioBitrateKbps <= 0) return false;
  } else if (mediaType.value === 'audio') {
    if (audio.value.onlyBitrateKbps <= 0) return false;
  } else if (mediaType.value === 'image') {
    if (image.value.width <= 0 || image.value.height <= 0) return false;
  }
  return true;
});
</script>

<template>
  <component
    :is="modalWrapper"
    v-model:open="isOpen"
    :title="t('videoEditor.export.convertFile', { file: fileName })"
    :ui="modalUi"
  >
    <div class="flex flex-col gap-6">
      <div v-if="isExtractingMetadata" class="flex items-center gap-2 text-sm text-ui-text-muted">
        <UIcon name="i-lucide-loader-2" class="animate-spin" />
        {{ t('videoEditor.fileManager.convert.loadingMetadata') }}
      </div>

      <template v-if="mediaType === 'video'">
        {{ t('videoEditor.fileManager.convert.targetFile') }}
        <span class="font-mono text-ui-text">{{ fileName }}</span>
      </template>

      <div class="text-sm text-ui-text-muted">
        {{ t('videoEditor.fileManager.convert.outputFile') }}
        <span class="font-mono text-ui-text">{{ outputFileName }}</span>
      </div>

      <div
        v-if="conversionError"
        class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
      >
        {{ conversionError }}
      </div>

      <div
        v-if="conversionWarnings.length > 0"
        class="p-3 text-sm text-amber-300 bg-amber-400/10 rounded-md border border-amber-400/20 flex flex-col gap-1"
      >
        <div class="font-medium flex items-center gap-1.5">
          <UIcon name="i-heroicons-exclamation-triangle" class="w-4 h-4" />
          {{
            t('videoEditor.fileManager.convert.warningsTitle', { count: conversionWarnings.length })
          }}
        </div>
        <ul class="list-disc list-inside space-y-0.5">
          <li
            v-for="(warning, index) in conversionWarnings"
            :key="index"
            class="text-xs leading-snug"
          >
            {{ warning }}
          </li>
        </ul>
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
            :has-audio="sourceHasAudio"
            :hide-audio-bitrate="false"
            :show-audio-advanced="true"
            :original-audio-sample-rate="audio.originalSampleRate"
            :original-audio-channels="audio.originalChannels"
            :allow-original-audio-sample-rate="true"
          />
        </div>
      </template>

      <template v-else-if="mediaType === 'audio'">
        <div class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.export.outputFormat') }}
            </label>
            <UiButtonGroup
              v-model="audio.onlyFormat"
              :options="audioFormatOptions as { value: string; label: string }[]"
            />
          </div>

          <FileConversionAudioSettings
            v-model:audio-bitrate-kbps="audio.onlyBitrateKbps"
            v-model:audio-channels="audio.channels"
            v-model:audio-sample-rate="audio.sampleRate"
            v-model:audio-reverse="audio.reverse"
            :show-reverse="true"
            :original-sample-rate="audio.originalSampleRate"
            :original-channels="audio.originalChannels"
            :allow-original-sample-rate="true"
          />
        </div>
      </template>

      <template v-else-if="mediaType === 'image'">
        <div class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.fileManager.convert.imageFormat') }}
            </label>
            <div class="text-sm font-medium text-ui-text">WebP</div>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.fileManager.convert.imageQuality') }}
            </label>
            <UiWheelNumberInput v-model="image.quality" :min="1" :max="100" :step="1" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">W</label>
              <UiWheelNumberInput
                :model-value="image.width"
                :min="1"
                :step="2"
                @update:model-value="onImageWidthChange"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">H</label>
              <UiWheelNumberInput
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
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="primary"
          data-primary-focus="true"
          :disabled="!isFormValid || isConverting || isExtractingMetadata"
          :loading="isConverting"
          @click="startConversion"
        >
          {{ t('videoEditor.export.convert') }}
        </UButton>
      </div>
    </template>
  </component>
</template>
