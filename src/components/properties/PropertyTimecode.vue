<script setup lang="ts">
import PropertyField from './PropertyField.vue';
import TimecodeInput from '~/components/common/TimecodeInput.vue';

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
    <TimecodeInput
      :model-value="props.modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </PropertyField>
</template>
