<script setup lang="ts">
interface Option {
  label?: string;
  value: any;
  icon?: string;
  disabled?: boolean;
  title?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | boolean | any;
    options: Option[];
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    color?: 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
    activeColor?: 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
    variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle';
    activeVariant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle';
    disabled?: boolean;
    orientation?: 'horizontal' | 'vertical';
    fluid?: boolean;
    ui?: any;
  }>(),
  {
    size: 'sm',
    color: 'neutral',
    activeColor: 'primary',
    variant: 'outline',
    activeVariant: 'solid',
    disabled: false,
    orientation: 'horizontal',
    fluid: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: any];
  change: [value: any];
}>();

function select(option: Option) {
  if (props.disabled || option.disabled) return;
  emit('update:modelValue', option.value);
  emit('change', option.value);
}

function isSelected(value: any) {
  return props.modelValue === value;
}
</script>

<template>
  <div
    class="rounded-lg shadow-sm isolate"
    :class="[
      orientation === 'horizontal' ? 'flex -space-x-px' : 'flex flex-col -space-y-px',
      fluid ? 'w-full' : 'inline-flex',
      disabled ? 'opacity-50 cursor-not-allowed' : '',
    ]"
  >
    <UButton
      v-for="option in options"
      :key="String(option.value)"
      :label="option.label"
      :icon="option.icon"
      :size="size"
      :color="isSelected(option.value) ? activeColor : color"
      :variant="isSelected(option.value) ? activeVariant : variant"
      :disabled="disabled || option.disabled"
      :title="option.title"
      class="focus:z-10 rounded-none! transition-all duration-200 justify-center whitespace-normal h-auto py-2"
      :class="[
        !(disabled || option.disabled) ? 'cursor-pointer' : '',
        orientation === 'horizontal'
          ? 'first:rounded-s-lg! last:rounded-e-lg!'
          : 'first:rounded-t-lg! last:rounded-b-lg!',
        fluid ? 'flex-1 w-full' : '',
      ]"
      @click="select(option)"
    >
      <slot name="option" :option="option" :selected="isSelected(option.value)" />
    </UButton>
  </div>
</template>
