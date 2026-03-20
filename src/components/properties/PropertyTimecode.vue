<script setup lang="ts">
import PropertyField from './PropertyField.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

const props = defineProps<{
  label: string;
  modelValue: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [val: number];
}>();
</script>

<template>
  <PropertyField :label="props.label" class="mt-2">
    <UiTimecode
      :model-value="props.modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </PropertyField>
</template>
