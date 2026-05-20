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
}

const props = withDefaults(defineProps<Props>(), {
  blendMode: 'normal',
  blendModeOptions: () => [],
  showBlendMode: true,
});

const emit = defineEmits<{
  (e: 'update:color', val: string): void;
  (e: 'update:alpha', val: number): void;
  (e: 'update:blendMode', val: TimelineBlendMode): void;
}>();

const alphaPercent = computed({
  get: () => Math.round(Math.max(0, Math.min(1, props.alpha)) * 100),
  set: (v: number) => emit('update:alpha', Math.max(0, Math.min(100, Number(v))) / 100),
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
    emit('update:blendMode', safe as TimelineBlendMode);
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
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <UColorPicker
        :model-value="props.color"
        format="hex"
        size="sm"
        @update:model-value="onColorPickerUpdate"
      />
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
    <UiSliderInput v-model="alphaPercent" :min="0" :max="100" :step="1" unit="%" :decimals="0" />
    <UiSelect
      v-if="props.showBlendMode"
      v-model="blendModeValue"
      :items="props.blendModeOptions"
      value-key="value"
      label-key="label"
      size="xs"
      full-width
    />
  </div>
</template>
