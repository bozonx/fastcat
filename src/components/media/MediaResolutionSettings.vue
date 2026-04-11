<script setup lang="ts">
import { computed, watch } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiFpsInputWithPresets from '~/components/ui/editor/UiFpsInputWithPresets.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

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
  { value: '480p', label: t('videoEditor.resolution.preset.480p') },
  { value: '720p', label: t('videoEditor.resolution.preset.720p') },
  { value: '1080p', label: t('videoEditor.resolution.preset.1080p') },
  { value: '2.7k', label: t('videoEditor.resolution.preset.2.7k') },
  { value: '4k', label: t('videoEditor.resolution.preset.4k') },
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
    title: t('videoEditor.resolution.landscape'),
  },
  {
    value: 'portrait',
    icon: 'i-heroicons-device-phone-mobile',
    title: t('videoEditor.resolution.portrait'),
  },
];

const aspectRatioOptions = [
  { value: '16:9', label: t('videoEditor.resolution.aspect.16_9') },
  { value: '9:16', label: t('videoEditor.resolution.aspect.9_16') },
  { value: '4:3', label: t('videoEditor.resolution.aspect.4_3') },
  { value: '1:1', label: t('videoEditor.resolution.aspect.1_1') },
  { value: '21:9', label: t('videoEditor.resolution.aspect.21_9') },
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
    <UiFormField :label="t('videoEditor.resolution.customResolution')">
      <USwitch v-model="localIsCustom" :disabled="disabled" />
    </UiFormField>

    <!-- Preset Mode -->
    <template v-if="!localIsCustom">
      <div class="flex flex-wrap gap-2">
        <UiFormField
          :label="t('videoEditor.resolution.orientation')"
          class="w-20 shrink-0"
        >
          <UiButtonGroup
            v-model="localOrientation"
            :options="orientationOptions as any"
            :disabled="disabled"
            :ui="{ base: 'px-2' }"
            class="w-full h-8"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.resolution.aspectRatio')"
          class="w-20 shrink-0"
        >
          <UiSelect
            v-model="localAspectRatio"
            :items="aspectRatioOptions"
            :disabled="disabled || disableAspectRatio"
            size="sm"
            full-width
            value-key="value"
            label-key="label"
            :search-input="false"
          />
        </UiFormField>

        <UiFormField :label="t('videoEditor.resolution.format')" class="w-28">
          <UiSelect
            v-model="localFormat"
            :items="formatOptions"
            :disabled="disabled"
            size="sm"
            full-width
            value-key="value"
            label-key="label"
            :search-input="false"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.resolution.finalResolution')"
          class="flex-1 shrink-0"
        >
          <div
            class="text-sm text-ui-text font-mono font-medium bg-ui-bg-accent px-3 rounded flex items-center justify-center border border-ui-border/50 h-8"
          >
            {{ localWidth }} &times; {{ localHeight }}
          </div>
        </UiFormField>
      </div>
    </template>

    <!-- Custom Mode -->
    <template v-else>
      <div class="grid grid-cols-2 gap-4">
        <UiFormField :label="t('videoEditor.export.width')" class="flex-1">
          <UiWheelNumberInput
            v-model="localWidth"
            :min="2"
            :step="2"
            :disabled="disabled"
            full-width
          />
        </UiFormField>
        <UiFormField :label="t('videoEditor.export.height')" class="flex-1">
          <UiWheelNumberInput
            v-model="localHeight"
            :min="2"
            :step="2"
            :disabled="disabled"
            full-width
          />
        </UiFormField>
      </div>
      <div class="text-xs text-ui-text-muted flex justify-end">
        {{
          localOrientation === 'portrait'
            ? t('videoEditor.resolution.portrait')
            : t('videoEditor.resolution.landscape')
        }}
      </div>
    </template>

    <!-- FPS -->
    <div
      :class="
        props.showAudioSettings ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'flex flex-col gap-2'
      "
    >
      <UiFormField :label="t('videoEditor.export.fps')">
        <UiFpsInputWithPresets v-model="localFps" :disabled="disabled" />
      </UiFormField>

      <template v-if="props.showAudioSettings">
        <UiFormField :label="t('videoEditor.audio.sampleRate')">
          <UiSelect
            v-model.number="localSampleRate"
            :items="sampleRateOptions"
            :disabled="disabled"
            size="sm"
            full-width
            value-key="value"
            label-key="label"
            :search-input="false"
          />
        </UiFormField>
      </template>
    </div>
  </div>
</template>
