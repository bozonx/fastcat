<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import MediaEncodingSettings, { type FormatOption } from '~/components/media/MediaEncodingSettings.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import { BASE_VIDEO_CODEC_OPTIONS, checkVideoCodecSupport, resolveVideoCodecOptions } from '~/utils/webcodecs';

const props = defineProps<{
  open: boolean;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | 'timeline' | null;
  fileName: string;
  isConverting: boolean;
  conversionProgress: number;
  conversionError: string | null;
  conversionPhase: 'encoding' | 'saving' | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'convert': [];
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

// Audio Settings
const audioOnlyFormat = defineModel<'webm' | 'mp4'>('audioOnlyFormat', { default: 'webm' });
const audioOnlyCodec = defineModel<'opus' | 'aac'>('audioOnlyCodec', { default: 'opus' });
const audioOnlyBitrateKbps = defineModel<number>('audioOnlyBitrateKbps', { default: 128 });
const audioChannels = defineModel<'stereo' | 'mono'>('audioChannels', { default: 'stereo' });
const audioSampleRate = defineModel<number>('audioSampleRate', { default: 48000 });

// Image Settings
const imageQuality = defineModel<number>('imageQuality', { default: 80 });

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mkv', label: 'MKV (AV1)' },
];

const audioFormatOptions: readonly FormatOption[] = [
  { value: 'webm', label: 'WEBM' },
  { value: 'mp4', label: 'MP4' },
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
  if (props.conversionPhase === 'encoding') return t('videoEditor.export.phaseEncoding', 'Encoding');
  if (props.conversionPhase === 'saving') return t('videoEditor.export.phaseSaving', 'Saving');
  return '';
});

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
        {{ t('videoEditor.fileManager.convert.targetFile', 'Converting:') }} <span class="font-mono text-ui-text">{{ fileName }}</span>
      </div>

      <div v-if="mediaType === 'video'" class="space-y-4">
        <MediaEncodingSettings
          v-model:output-format="videoFormat"
          v-model:video-codec="videoCodec"
          v-model:bitrate-mbps="videoBitrateMbps"
          v-model:exclude-audio="excludeAudio"
          v-model:audio-codec="audioCodec"
          v-model:audio-bitrate-kbps="audioBitrateKbps"
          v-model:bitrate-mode="bitrateMode"
          v-model:keyframe-interval-sec="keyframeIntervalSec"
          :disabled="isConverting"
          :show-metadata="false"
          :has-audio="true"
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

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.export.audioCodec', 'Audio codec') }}
          </label>
          <div class="w-full">
            <UiAppButtonGroup
              v-model="audioOnlyCodec"
              :options="audioCodecOptions"
              :disabled="isConverting"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)') }}
          </label>
          <WheelNumberInput v-model="audioOnlyBitrateKbps" :min="32" :step="16" :disabled="isConverting" />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.fileManager.audio.channels', 'Channels') }}
          </label>
          <UiAppButtonGroup
            v-model="audioChannels"
            :options="[{ value: 'stereo', label: 'Stereo' }, { value: 'mono', label: 'Mono' }]"
            :disabled="isConverting"
          />
        </div>
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
          <WheelNumberInput v-model="imageQuality" :min="1" :max="100" :step="1" :disabled="isConverting" />
        </div>
      </div>

      <div v-if="conversionError" class="p-3 text-sm text-error-400 bg-error-400/10 rounded-md border border-error-400/20">
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
          variant="ghost"
          color="neutral"
          :label="t('common.cancel', 'Cancel')"
          :disabled="isConverting"
          @click="isOpen = false"
        />
        <UButton
          variant="solid"
          color="primary"
          :label="isConverting ? t('videoEditor.fileManager.convert.converting', 'Converting...') : t('videoEditor.fileManager.convert.start', 'Convert')"
          :loading="isConverting"
          @click="emit('convert')"
        />
      </div>
    </template>
  </AppModal>
</template>
