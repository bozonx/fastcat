<script setup lang="ts">
import { computed } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { useBatchConversion } from '~/composables/file-conversion/useBatchConversion';
import { resolveAudioOnlyFileExtension } from '~/utils/conversion/helpers';
import { AUDIO_EXPORT_CODEC_OPTIONS } from '~/utils/webcodecs';
import { useExportCodecs } from '~/composables/timeline/export/core/useExportCodecs';
import { isTauriRuntime } from '~/utils/runtime';

const { t } = useI18n();

const modalUi = computed(() => {
  if (conversionType.value === 'video') {
    return { content: 'sm:max-w-2xl' };
  }
  return { content: 'sm:max-w-md' };
});

const batchConversion = useBatchConversion();
const {
  state,
  videoSettings,
  audioSettings,
  imageSettings,
  modalTitle,
  startConversion,
  cancelConversion,
} = batchConversion;

const conversionType = computed(() => state.conversionType);
const isOpen = computed({
  get: () => state.isModalOpen,
  set: (value) => {
    if (!value) cancelConversion();
    state.isModalOpen = value;
  },
});

const { audioCodecSupport, loadCodecSupport } = useExportCodecs();

onMounted(() => {
  loadCodecSupport();
});

const audioFormatOptions = computed(() => {
  const isTauri = isTauriRuntime();
  const filtered = AUDIO_EXPORT_CODEC_OPTIONS.filter((opt) => {
    if (!isTauri && (opt.value === 'flac' || opt.value === 'mp3')) {
      return false;
    }
    return true;
  });
  return filtered.map((opt) => ({
    ...opt,
    disabled: !audioCodecSupport.value[opt.value as keyof typeof audioCodecSupport.value],
  }));
});

const fileCount = computed(() => state.entries.length);

const outputFileName = computed(() => {
  if (conversionType.value === 'video') {
    return t('videoEditor.fileManager.batchConvert.outputPatternVideo', {
      format: videoSettings.format,
    });
  }
  if (conversionType.value === 'audio') {
    const ext = resolveAudioOnlyFileExtension(audioSettings.onlyFormat);
    return t('videoEditor.fileManager.batchConvert.outputPatternAudio', { format: ext });
  }
  if (conversionType.value === 'image') {
    return t('videoEditor.fileManager.batchConvert.outputPatternImage', { format: 'webp' });
  }
  return '';
});

function clampPositiveInt(value: number) {
  const v = Math.round(Number(value) || 0);
  return Math.max(1, v);
}

function onImageWidthChange(val: number) {
  imageSettings.width = val;
  if (imageSettings.isResolutionLinked && imageSettings.aspectRatio) {
    imageSettings.height = clampPositiveInt(val / imageSettings.aspectRatio);
  }
}

function onImageHeightChange(val: number) {
  imageSettings.height = val;
  if (imageSettings.isResolutionLinked && imageSettings.aspectRatio) {
    imageSettings.width = clampPositiveInt(val * imageSettings.aspectRatio);
  }
}

const isFormValid = computed(() => {
  if (conversionType.value === 'video') {
    if (videoSettings.bitrateMbps <= 0) return false;
    if (videoSettings.width <= 0 || videoSettings.height <= 0) return false;
    if (videoSettings.fps <= 0) return false;
    if (videoSettings.keyframeIntervalSec <= 0) return false;
    if (!videoSettings.excludeAudio && videoSettings.audioBitrateKbps <= 0) return false;
  } else if (conversionType.value === 'audio') {
    if (audioSettings.onlyBitrateKbps <= 0) return false;
  } else if (conversionType.value === 'image') {
    if (imageSettings.width <= 0 || imageSettings.height <= 0) return false;
  }
  return true;
});
</script>

<template>
  <UiModal v-model:open="isOpen" :title="modalTitle" :ui="modalUi">
    <div class="flex flex-col gap-6">
      <div class="bg-ui-bg-muted/40 border border-ui-border/50 rounded-lg p-3.5 space-y-2">
        <div class="text-xs text-ui-text-muted">
          {{ t('videoEditor.fileManager.batchConvert.filesCount', { count: fileCount }) }}
        </div>
        <div class="font-mono text-sm text-ui-text truncate" :title="outputFileName">
          {{ outputFileName }}
        </div>
      </div>

      <div
        v-if="state.conversionError"
        class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
      >
        {{ state.conversionError }}
      </div>

      <template v-if="conversionType === 'video'">
        <div class="space-y-4">
          <div class="bg-ui-bg-muted/40 border border-ui-border/50 rounded-lg p-3.5 space-y-2">
            <div class="text-xs text-ui-text-muted">
              {{ t('videoEditor.fileManager.batchConvert.originalResolutionAndFps') }}
            </div>
          </div>

          <div class="h-px bg-ui-border"></div>

          <VideoEncodingForm
            v-model:output-format="videoSettings.format"
            v-model:video-codec="videoSettings.videoCodec"
            v-model:bitrate-mbps="videoSettings.bitrateMbps"
            v-model:exclude-audio="videoSettings.excludeAudio"
            v-model:audio-codec="videoSettings.audioCodec"
            v-model:audio-bitrate-kbps="videoSettings.audioBitrateKbps"
            v-model:audio-channels="audioSettings.channels"
            v-model:audio-sample-rate="audioSettings.sampleRate"
            v-model:bitrate-mode="videoSettings.bitrateMode"
            v-model:keyframe-interval-sec="videoSettings.keyframeIntervalSec"
            v-model:fast-start="videoSettings.fastStart"
            :show-metadata="false"
            :show-presets="true"
            :has-audio="true"
            :hide-audio-bitrate="false"
            :show-audio-advanced="true"
            :original-audio-sample-rate="audioSettings.originalSampleRate"
            :original-audio-channels="audioSettings.originalChannels"
            :allow-original-audio-sample-rate="true"
            :hide-audio-sample-rate="true"
          />
        </div>
      </template>

      <template v-else-if="conversionType === 'audio'">
        <div class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">
              {{ t('videoEditor.export.outputFormat') }}
            </label>
            <UiButtonGroup
              v-model="audioSettings.onlyFormat"
              :options="audioFormatOptions as { value: string; label: string }[]"
            />
          </div>

          <FileConversionAudioSettings
            v-model:audio-bitrate-kbps="audioSettings.onlyBitrateKbps"
            v-model:audio-channels="audioSettings.channels"
            v-model:audio-sample-rate="audioSettings.sampleRate"
            v-model:audio-reverse="audioSettings.reverse"
            :show-reverse="true"
            :original-sample-rate="audioSettings.originalSampleRate"
            :original-channels="audioSettings.originalChannels"
            :allow-original-sample-rate="true"
            hide-sample-rate
          />
        </div>
      </template>

      <template v-else-if="conversionType === 'image'">
        <div class="space-y-5">
          <UiSliderInput
            v-model="imageSettings.quality"
            :label="t('videoEditor.fileManager.convert.imageQuality')"
            :min="1"
            :max="100"
            :step="1"
            :decimals="0"
            unit="%"
          />

          <div class="flex items-end gap-3 w-full">
            <div class="flex-1 flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">
                {{ t('videoEditor.export.width') }}
              </label>
              <UiWheelNumberInput
                :model-value="imageSettings.width"
                :min="1"
                :step="2"
                @update:model-value="onImageWidthChange"
              />
            </div>

            <div class="flex items-center justify-center h-9 shrink-0">
              <UButton
                :color="imageSettings.isResolutionLinked ? 'primary' : 'neutral'"
                :variant="imageSettings.isResolutionLinked ? 'soft' : 'ghost'"
                :icon="imageSettings.isResolutionLinked ? 'i-lucide-link' : 'i-lucide-link-2'"
                size="sm"
                class="h-9 w-9 p-0 flex items-center justify-center"
                :title="t('videoEditor.fileManager.convert.keepAspectRatio')"
                @click="imageSettings.isResolutionLinked = !imageSettings.isResolutionLinked"
              />
            </div>

            <div class="flex-1 flex flex-col gap-2">
              <label class="text-xs text-ui-text-muted font-medium">
                {{ t('videoEditor.export.height') }}
              </label>
              <UiWheelNumberInput
                :model-value="imageSettings.height"
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
          :disabled="!isFormValid || state.isConverting"
          :loading="state.isConverting"
          @click="startConversion"
        >
          {{ t('videoEditor.export.convert') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
