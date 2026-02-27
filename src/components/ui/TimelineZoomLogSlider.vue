<script setup lang="ts">
import { computed } from 'vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    sliderClass?: string;
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    sliderClass: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const value = computed({
  get: () => {
    const v = Number(props.modelValue);
    if (!Number.isFinite(v)) return 50;
    return Math.min(props.max, Math.max(props.min, v));
  },
  set: (val: number) => {
    const v = Number(val);
    if (!Number.isFinite(v)) return;
    emit('update:modelValue', Math.min(props.max, Math.max(props.min, v)));
  },
});
</script>

<template>
  <WheelSlider
    v-model="value"
    :min="min"
    :max="max"
    :step="step"
    :slider-class="sliderClass"
  />
</template>
