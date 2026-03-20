<script setup lang="ts">
import { computed, watch } from 'vue';
import UiWheelNumberInput from '~/components/ui/editor/UiWheelNumberInput.vue';
import UiFpsInputWithPresets from '~/components/ui/editor/UiFpsInputWithPresets.vue';

const localWidth = defineModel<number>('width', { required: true });
const localHeight = defineModel<number>('height', { required: true });
const localFps = defineModel<number>('fps', { required: true });
const localFormat = defineModel<string>('resolutionFormat', { required: true });
const localOrientation = defineModel<'landscape' | 'portrait'>('orientation', { required: true });
const localAspectRatio = defineModel<string>('aspectRatio', { required: true });
const localIsCustom = defineModel<boolean>('isCustomResolution', { required: true });
const localSampleRate = defineModel<number>('sampleRate', { default: 48000 });

const props = withDefaults(
  defineProps<{
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

const { t } = useI18n();

const formatOptions = [
  { value: '480p', label: t('videoEditor.resolution.preset.480p', '480p (Preview)') },
  { value: '720p', label: t('videoEditor.resolution.preset.720p', '720p (HD)') },
  { value: '1080p', label: t('videoEditor.resolution.preset.1080p', '1080p (FHD)') },
  { value: '2.7k', label: t('videoEditor.resolution.preset.2.7k', '2.7K (QHD)') },
  { value: '4k', label: t('videoEditor.resolution.preset.4k', '4K (UHD)') },
];

const sampleRateOptions = [
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' },
  { value: 96000, label: '96 kHz' },
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
  { value: '9:16', label: t('videoEditor.resolution.aspect.9_16', '9:16') },
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
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '1:1': 1,
  '21:9': 21 / 9,
};

function calculateDimensions(format: string, orientationValue: string, ratioStr: string) {
  const base = bases[format] || 1080;
  const ratio = ratios[ratioStr] || 16 / 9;

  let w = 0;
  let h = 0;

  if (orientationValue === 'landscape') {
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
  ([format, orientationValue, ratioStr, isCustom]) => {
    if (!isCustom) {
      const { w, h } = calculateDimensions(format, orientationValue, ratioStr);
      if (localWidth.value !== w) localWidth.value = w;
      if (localHeight.value !== h) localHeight.value = h;
    }
  },
  { immediate: true },
);

// Auto-detect orientation and ratio when custom resolution is modified
watch([localWidth, localHeight, localIsCustom], ([w, h, isCustom]) => {
  if (isCustom) {
    const isPortrait = h > w;
    const newOrientation = isPortrait ? 'portrait' : 'landscape';
    if (localOrientation.value !== newOrientation) {
      localOrientation.value = newOrientation;
    }
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
      <div class="flex flex-wrap gap-2">
        <div class="flex flex-col gap-2 w-20 shrink-0">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.resolution.orientation', 'Orientation') }}
          </label>
          <UiButtonGroup
            v-model="localOrientation"
            :options="orientationOptions as any"
            :disabled="disabled"
            :ui="{ base: 'px-2' }"
            class="w-full h-8"
          />
        </div>

        <div class="flex flex-col gap-2 w-20 shrink-0">
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

        <div class="flex flex-col gap-2 w-28">
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

        <div class="flex flex-col gap-2 flex-1 shrink-0">
          <label class="text-xs text-ui-text-muted font-medium whitespace-nowrap">
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
          <UiWheelNumberInput
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
          <UiWheelNumberInput
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
    <div
      :class="
        props.showAudioSettings ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'flex flex-col gap-2'
      "
    >
      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.fps', 'FPS') }}
        </label>
        <UiFpsInputWithPresets v-model="localFps" :disabled="disabled" />
      </div>

      <template v-if="props.showAudioSettings">
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
      </template>
    </div>
  </div>
</template>
