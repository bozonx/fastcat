<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
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
}>();

const { t } = useI18n();

const formatOptions = [
  { value: '720p', label: '720p (HD)' },
  { value: '1080p', label: '1080p (FHD)' },
  { value: '2.7k', label: '2.7K (QHD)' },
  { value: '4k', label: '4K (UHD)' },
];

const orientationOptions = [
  { value: 'landscape', label: t('videoEditor.resolution.landscape', 'Landscape') },
  { value: 'portrait', label: t('videoEditor.resolution.portrait', 'Portrait') },
];

const aspectRatioOptions = [
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '1:1', label: '1:1' },
  { value: '21:9', label: '21:9' },
];

const bases: Record<string, number> = {
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
    <UFormField :label="t('videoEditor.resolution.customResolution', 'Custom Resolution')">
      <USwitch v-model="localIsCustom" :disabled="disabled" />
    </UFormField>

    <!-- Preset Mode -->
    <template v-if="!localIsCustom">
      <div class="grid grid-cols-3 gap-4">
        <UFormField :label="t('videoEditor.resolution.format', 'Format')">
          <USelectMenu
            :model-value="
              formatOptions.find((o) => o.value === localFormat) || (localFormat as any)
            "
            :items="formatOptions"
            :disabled="disabled"
            class="w-full"
            value-key="value"
            label-key="label"
            @update:model-value="(v: any) => (localFormat = v?.value ?? v)"
          />
        </UFormField>

        <UFormField :label="t('videoEditor.resolution.orientation', 'Orientation')">
          <USelectMenu
            :model-value="
              orientationOptions.find((o) => o.value === localOrientation) ||
              (localOrientation as any)
            "
            :items="orientationOptions"
            :disabled="disabled"
            class="w-full"
            value-key="value"
            label-key="label"
            @update:model-value="(v: any) => (localOrientation = v?.value ?? v)"
          />
        </UFormField>

        <UFormField :label="t('videoEditor.resolution.aspectRatio', 'Aspect Ratio')">
          <USelectMenu
            :model-value="
              aspectRatioOptions.find((o) => o.value === localAspectRatio) ||
              (localAspectRatio as any)
            "
            :items="aspectRatioOptions"
            :disabled="disabled"
            class="w-full"
            value-key="value"
            label-key="label"
            @update:model-value="(v: any) => (localAspectRatio = v?.value ?? v)"
          />
        </UFormField>
      </div>

      <div
        class="text-sm text-gray-500 font-medium bg-gray-50 dark:bg-gray-800 p-3 rounded-md flex justify-between items-center"
      >
        <span>{{ t('videoEditor.resolution.finalResolution', 'Final Resolution:') }}</span>
        <span class="font-mono text-gray-900 dark:text-gray-100"
          >{{ localWidth }} &times; {{ localHeight }}</span
        >
      </div>
    </template>

    <!-- Custom Mode -->
    <template v-else>
      <div class="grid grid-cols-2 gap-4">
        <UFormField :label="t('videoEditor.export.width', 'Width')">
          <UInput
            v-model.number="localWidth"
            type="number"
            inputmode="numeric"
            min="2"
            step="2"
            class="w-full"
            :disabled="disabled"
          />
        </UFormField>
        <UFormField :label="t('videoEditor.export.height', 'Height')">
          <UInput
            v-model.number="localHeight"
            type="number"
            inputmode="numeric"
            min="2"
            step="2"
            class="w-full"
            :disabled="disabled"
          />
        </UFormField>
      </div>
      <div class="text-xs text-gray-500 flex justify-end">
        {{
          localOrientation === 'portrait'
            ? t('videoEditor.resolution.portrait', 'Portrait')
            : t('videoEditor.resolution.landscape', 'Landscape')
        }}
      </div>
    </template>

    <!-- FPS -->
    <UFormField :label="t('videoEditor.export.fps', 'FPS')">
      <UInput
        v-model.number="localFps"
        type="number"
        inputmode="numeric"
        min="1"
        max="240"
        step="1"
        class="w-full"
        :disabled="disabled"
      />
    </UFormField>
  </div>
</template>
