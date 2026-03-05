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

const props = defineProps<{
  open: boolean;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | 'timeline' | null;
  fileName: string;
  originalAudioSampleRate?: number | null;
  isConverting: boolean;
  conversionProgress: number;
  conversionError: string | null;
  conversionPhase: 'encoding' | 'saving' | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  convert: [];
  cancel: [];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

// Video Settings
const videoFormat = defineModel<'mp4' | 'webm' | 'mkv'>('videoFormat', { default: 'mp4' });
const videoCodec = defineModel<string>('videoCodec', { default: 'avc1.640032' });
const videoBitrateMbps = defineModel<number>('videoBitrateMbps', { default: 5 });
const excludeAudio = defineModel<boolean>('excludeAudio', { default: false });
const audioCodec = defineModel<'aac' | 'opus'>('audioCodec', { default: 'aac' });
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { default: 128 });
const bitrateMode = defineModel<'constant' | 'variable'>('bitrateMode', { default: 'variable' });
const keyframeIntervalSec = defineModel<number>('keyframeIntervalSec', { default: 2 });
const videoWidth = defineModel<number>('videoWidth', { default: 1920 });
const videoHeight = defineModel<number>('videoHeight', { default: 1080 });
const videoFps = defineModel<number>('videoFps', { default: 30 });
const resolutionFormat = defineModel<string>('resolutionFormat', { default: '1080p' });
const orientation = defineModel<'landscape' | 'portrait'>('orientation', { default: 'landscape' });
const aspectRatio = defineModel<string>('aspectRatio', { default: '16:9' });
const isCustomResolution = defineModel<boolean>('isCustomResolution', { default: false });

// Audio Settings
const audioOnlyFormat = defineModel<'opus' | 'aac'>('audioOnlyFormat', { default: 'opus' });
const audioOnlyCodec = defineModel<'opus' | 'aac'>('audioOnlyCodec', { default: 'opus' });
const audioOnlyBitrateKbps = defineModel<number>('audioOnlyBitrateKbps', { default: 128 });
const audioChannels = defineModel<'stereo' | 'mono'>('audioChannels', { default: 'stereo' });
const audioSampleRate = defineModel<number>('audioSampleRate', { default: 0 });

// Image Settings
const imageQuality = defineModel<number>('imageQuality', { default: 80 });
const imageWidth = defineModel<number>('imageWidth', { default: 0 });
const imageHeight = defineModel<number>('imageHeight', { default: 0 });
const isImageResolutionLinked = defineModel<boolean>('isImageResolutionLinked', { default: true });
const imageAspectRatio = defineModel<number>('imageAspectRatio', { default: 1 });

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
  if (props.conversionPhase === 'encoding')
    return t('videoEditor.export.phaseEncoding', 'Encoding');
  if (props.conversionPhase === 'saving') return t('videoEditor.export.phaseSaving', 'Saving');
  return '';
});

const outputFileName = computed(() => {
  const baseName = props.fileName.replace(/\.[^.]+$/, '');
  if (props.mediaType === 'video') {
    return `${baseName}_converted.${videoFormat.value}`;
  }
  if (props.mediaType === 'audio') {
    const ext = audioOnlyFormat.value;
    return `${baseName}_converted.${ext}`;
  }
  if (props.mediaType === 'image') {
    return `${baseName}_converted.webp`;
  }
  return props.fileName;
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
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.convert.title', 'Convert File')"
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
    :prevent-close="isConverting"
  >
    <div class="space-y-6">
      <div class="text-sm text-ui-text-muted">
        {{ t('videoEditor.fileManager.convert.targetFile', 'Converting:') }}
        <span class="font-mono text-ui-text">{{ fileName }}</span>
      </div>

      <div class="text-sm text-ui-text-muted">
        {{ t('videoEditor.fileManager.convert.outputFile', 'Output:') }}
        <span class="font-mono text-ui-text">{{ outputFileName }}</span>
      </div>

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
          :original-audio-sample-rate="props.originalAudioSampleRate"
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
          :original-sample-rate="props.originalAudioSampleRate"
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
              @update:model-value="onImageWidthChange" 
              :min="1" 
              :step="2" 
              :disabled="isConverting" 
            />
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs text-ui-text-muted font-medium">H</label>
            <WheelNumberInput 
              :model-value="imageHeight" 
              @update:model-value="onImageHeightChange" 
              :min="1" 
              :step="2" 
              :disabled="isConverting" 
            />
          </div>
        </div>
      </div>

      <div
        v-if="conversionError"
        class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20"
      >
        {{ conversionError }}
      </div>

      <div v-if="isConverting" class="flex flex-col gap-2">
        <div class="flex justify-between text-xs text-ui-text-muted">
          <span class="font-medium">{{ getPhaseLabel }}</span>
          <span class="font-mono">{{ Math.round(conversionProgress * 100) }}%</span>
        </div>
        <UProgress :value="conversionProgress * 100" />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton
          v-if="isConverting"
          variant="solid"
          color="error"
          :label="t('common.cancel', 'Cancel')"
          @click="emit('cancel')"
        />
        <template v-else>
          <UButton
            variant="ghost"
            color="neutral"
            :label="t('common.cancel', 'Cancel')"
            @click="isOpen = false"
          />
          <UButton
            variant="solid"
            color="primary"
            :label="t('videoEditor.fileManager.convert.start', 'Convert')"
            @click="emit('convert')"
          />
        </template>
      </div>
    </template>
  </AppModal>
</template>
