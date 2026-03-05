<script setup lang="ts">
import { computed, watch } from 'vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';

const props = withDefaults(
  defineProps<{
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    audioChannels?: 'stereo' | 'mono';
    sampleRate?: number;
    disabled?: boolean;
    showAudioSettings?: boolean;
    disableAspectRatio?: boolean;
  }>(),
  {
    disabled: false,
    showAudioSettings: true,
    disableAspectRatio: false,
  },
);

const emit = defineEmits<{
  'update:width': [value: number];
  'update:height': [value: number];
  'update:fps': [value: number];
  'update:resolutionFormat': [value: string];
  'update:orientation': [value: 'landscape' | 'portrait'];
  'update:aspectRatio': [value: string];
  'update:isCustomResolution': [value: boolean];
  'update:audioChannels': [value: 'stereo' | 'mono'];
  'update:sampleRate': [value: number];
}>();

const { t } = useI18n();

const formatOptions = [
  { value: '480p', label: t('videoEditor.resolution.preset.480p', '480p (Preview)') },
  { value: '720p', label: t('videoEditor.resolution.preset.720p', '720p (HD)') },
  { value: '1080p', label: t('videoEditor.resolution.preset.1080p', '1080p (FHD)') },
  { value: '2.7k', label: t('videoEditor.resolution.preset.2.7k', '2.7K (QHD)') },
  { value: '4k', label: t('videoEditor.resolution.preset.4k', '4K (UHD)') },
];

const audioChannelsOptions = [
  { value: 'stereo', label: t('videoEditor.audio.stereo', 'Stereo') },
  { value: 'mono', label: t('videoEditor.audio.mono', 'Mono') },
];

const sampleRateOptions = [
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' },
];

const orientationOptions = [
  {
    value: 'landscape',
    icon: 'i-heroicons-computer-desktop',
    title: t('videoEditor.resolution.landscape', 'Landscape'),
  },
  {
    value: 'portrait',
    icon: 'i-heroicons-device-phone-mobile',
    title: t('videoEditor.resolution.portrait', 'Portrait'),
  },
];

const aspectRatioOptions = [
  { value: '16:9', label: t('videoEditor.resolution.aspect.16_9', '16:9') },
  { value: '4:3', label: t('videoEditor.resolution.aspect.4_3', '4:3') },
  { value: '1:1', label: t('videoEditor.resolution.aspect.1_1', '1:1') },
  { value: '21:9', label: t('videoEditor.resolution.aspect.21_9', '21:9') },
];

const bases: Record<string, number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '2.7k': 1440,
  '4k': 2160,
};

const ratios: Record<string, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '21:9': 21 / 9,
};

const localFormat = computed({
  get: () => props.resolutionFormat,
  set: (val) => emit('update:resolutionFormat', val),
});

const localOrientation = computed({
  get: () => props.orientation,
  set: (val) => emit('update:orientation', val),
});

const localAspectRatio = computed({
  get: () => props.aspectRatio,
  set: (val) => emit('update:aspectRatio', val),
});

const localIsCustom = computed({
  get: () => props.isCustomResolution,
  set: (val) => emit('update:isCustomResolution', val),
});

const localWidth = computed({
  get: () => props.width,
  set: (val) => emit('update:width', val),
});

const localHeight = computed({
  get: () => props.height,
  set: (val) => emit('update:height', val),
});

const localFps = computed({
  get: () => props.fps,
  set: (val) => emit('update:fps', val),
});

const localAudioChannels = computed({
  get: () => props.audioChannels ?? 'stereo',
  set: (val) => emit('update:audioChannels', val),
});

const localSampleRate = computed({
  get: () => props.sampleRate ?? 48000,
  set: (val) => emit('update:sampleRate', val),
});

function calculateDimensions(format: string, orientation: string, ratioStr: string) {
  const base = bases[format] || 1080;
  const ratio = ratios[ratioStr] || 16 / 9;

  let w = 0;
  let h = 0;

  if (orientation === 'landscape') {
    h = base;
    w = Math.round(base * ratio);
  } else {
    w = base;
    h = Math.round(base * ratio);
  }

  // Ensure even dimensions
  w = Math.round(w / 2) * 2;
  h = Math.round(h / 2) * 2;

  return { w, h };
}

// Auto-calculate width/height when using preset formats
watch(
  [localFormat, localOrientation, localAspectRatio, localIsCustom],
  ([format, orientation, ratioStr, isCustom]) => {
    if (!isCustom) {
      const { w, h } = calculateDimensions(format, orientation, ratioStr);
      if (props.width !== w) emit('update:width', w);
      if (props.height !== h) emit('update:height', h);
    }
  },
  { immediate: true },
);

// Auto-detect orientation and ratio when custom resolution is modified
watch([localWidth, localHeight, localIsCustom], ([w, h, isCustom]) => {
  if (isCustom) {
    const isPortrait = h > w;
    const newOrientation = isPortrait ? 'portrait' : 'landscape';
    if (props.orientation !== newOrientation) {
      emit('update:orientation', newOrientation);
    }

    // We could try to guess aspect ratio, but it's not strictly necessary for custom mode
    // Just keep the current values, as they are ignored in calculation when isCustom = true
  }
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.resolution.customResolution', 'Custom Resolution') }}
      </label>
      <USwitch v-model="localIsCustom" :disabled="disabled" />
    </div>

    <!-- Preset Mode -->
    <template v-if="!localIsCustom">
      <div class="grid grid-cols-4 gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.resolution.orientation', 'Orientation') }}
          </label>
          <UiAppButtonGroup
            v-model="localOrientation"
            :options="orientationOptions as any"
            :disabled="disabled"
            :ui="{ base: 'px-2' }"
            class="w-full h-8"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.resolution.aspectRatio', 'Aspect Ratio') }}
          </label>
          <USelect
            v-model="localAspectRatio"
            :items="aspectRatioOptions"
            :disabled="disabled || disableAspectRatio"
            size="sm"
            class="w-full"
            value-key="value"
            label-key="label"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.resolution.format', 'Format') }}
          </label>
          <USelect
            v-model="localFormat"
            :items="formatOptions"
            :disabled="disabled"
            size="sm"
            class="w-full"
            value-key="value"
            label-key="label"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.resolution.finalResolution', 'Final Resolution:') }}
          </label>
          <div
            class="text-sm text-ui-text font-mono font-medium bg-ui-bg-accent px-3 rounded flex items-center justify-center border border-ui-border/50 h-8"
          >
            {{ localWidth }} &times; {{ localHeight }}
          </div>
        </div>
      </div>
    </template>

    <!-- Custom Mode -->
    <template v-else>
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.export.width', 'Width') }}
          </label>
          <WheelNumberInput
            v-model="localWidth"
            :min="2"
            :step="2"
            :disabled="disabled"
            class="flex-1"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.export.height', 'Height') }}
          </label>
          <WheelNumberInput
            v-model="localHeight"
            :min="2"
            :step="2"
            :disabled="disabled"
            class="flex-1"
          />
        </div>
      </div>
      <div class="text-xs text-ui-text-muted flex justify-end">
        {{
          localOrientation === 'portrait'
            ? t('videoEditor.resolution.portrait', 'Portrait')
            : t('videoEditor.resolution.landscape', 'Landscape')
        }}
      </div>
    </template>

    <!-- FPS -->
    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.fps', 'FPS') }}
      </label>
      <WheelNumberInput
        v-model="localFps"
        :min="1"
        :max="240"
        :step="0.001"
        :disabled="disabled"
      />
    </div>

    <div class="h-px bg-ui-border my-2"></div>

    <template v-if="props.showAudioSettings">
      <div class="text-sm font-semibold text-ui-text uppercase tracking-wider">
        {{ t('videoEditor.audio.audioSettings', 'Audio settings') }}
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.audio.channels', 'Channels') }}
          </label>
          <UiAppButtonGroup
            v-model="localAudioChannels"
            :options="audioChannelsOptions as any"
            :disabled="disabled"
            class="w-full"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.audio.sampleRate', 'Sample Rate') }}
          </label>
          <USelect
            v-model.number="localSampleRate"
            :items="sampleRateOptions"
            :disabled="disabled"
            size="sm"
            class="w-full"
            value-key="value"
            label-key="label"
          />
        </div>
      </div>
    </template>
  </div>
</template>
