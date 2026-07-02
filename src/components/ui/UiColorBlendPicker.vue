<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TimelineBlendMode } from '~/timeline/types';
import UiSelect from './UiSelect.vue';
import UiSliderInput from './UiSliderInput.vue';
import UiTextInput from './UiTextInput.vue';

interface Props {
  color: string;
  alpha: number;
  blendMode?: TimelineBlendMode;
  blendModeOptions?: Array<{ value: TimelineBlendMode; label: string }>;
  showBlendMode?: boolean;
  defaultAlpha?: number;
}

const props = withDefaults(defineProps<Props>(), {
  blendMode: 'normal',
  blendModeOptions: () => [],
  showBlendMode: true,
  defaultAlpha: 1,
});

const emit = defineEmits<{
  (e: 'update:color', val: string): void;
  (e: 'update:alpha', val: number): void;
  (e: 'update:blend-mode', val: TimelineBlendMode): void;
}>();

const { t } = useI18n();

const alphaPercent = computed({
  get: () => Math.round(Math.max(0, Math.min(1, props.alpha)) * 100),
  set: (v: number) => emit('update:alpha', Math.max(0, Math.min(100, Number(v))) / 100),
});

const defaultAlphaPercent = computed(() => {
  return Math.round(Math.max(0, Math.min(1, props.defaultAlpha)) * 100);
});

const colorText = ref(props.color);

watch(
  () => props.color,
  (value) => {
    if (value !== colorText.value) {
      colorText.value = value;
    }
  },
);

const blendModeValue = computed({
  get: () => props.blendMode ?? 'normal',
  set: (val: TimelineBlendMode | unknown) => {
    const safe =
      val === 'add' ||
      val === 'multiply' ||
      val === 'screen' ||
      val === 'darken' ||
      val === 'lighten'
        ? val
        : 'normal';
    emit('update:blend-mode', safe as TimelineBlendMode);
  },
});

function onColorPickerUpdate(val: unknown) {
  const str = String(val ?? '#ffffff');
  emit('update:color', str);
}

function commitColorText() {
  const trimmed = colorText.value.trim();
  if (/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)) {
    emit('update:color', trimmed.toLowerCase());
    return;
  }

  colorText.value = props.color;
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3">
    <div class="flex flex-col gap-1.5 min-w-0">
      <span class="text-2xs font-bold uppercase text-ui-text-muted">{{
        t('fastcat.textClip.colorPicker')
      }}</span>
      <div class="min-w-0">
        <UColorPicker
          :model-value="props.color"
          format="hex"
          size="sm"
          @update:model-value="onColorPickerUpdate"
        />
      </div>
      <span class="text-2xs font-bold uppercase text-ui-text-muted">{{
        t('fastcat.textClip.hue')
      }}</span>
    </div>
    <div class="flex flex-col gap-2 min-w-0">
      <UiSliderInput
        v-model="alphaPercent"
        :label="t('fastcat.textClip.opacity')"
        :min="0"
        :max="100"
        :step="1"
        unit="%"
        :decimals="0"
        :default-value="defaultAlphaPercent"
      />
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ t('fastcat.textClip.webColor') }}</span>
        <UiTextInput
          v-model="colorText"
          placeholder="#ffffff"
          size="xs"
          full-width
          mono
          @blur="commitColorText"
          @keydown.enter="commitColorText"
        />
      </div>
      <div v-if="props.showBlendMode" class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ t('fastcat.clip.blendMode.title') }}</span>
        <UiSelect
          v-model="blendModeValue"
          :items="props.blendModeOptions"
          value-key="value"
          label-key="label"
          size="xs"
          full-width
        />
      </div>
    </div>
  </div>
</template>
