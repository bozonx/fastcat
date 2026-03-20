<script setup lang="ts">
interface Option {
  label?: string;
  value: any;
  icon?: string;
  disabled?: boolean;
  title?: string;
  [key: string]: unknown;
}

const props = withDefaults(
  defineProps<{
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
    ui: undefined,
  },
);

const modelValue = defineModel<any>({ required: true });

const emit = defineEmits<{
  change: [value: any];
}>();

function select(option: Option) {
  if (props.disabled || option.disabled) return;
  modelValue.value = option.value;
  emit('change', option.value);
}

function isSelected(value: any) {
  return modelValue.value === value;
}
</script>

<template>
  <UFieldGroup
    :orientation="orientation"
    :class="[fluid ? 'w-full' : 'inline-flex', disabled ? 'opacity-50 cursor-not-allowed' : '']"
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
      class="transition-all duration-200 justify-center whitespace-normal h-auto py-1.5 px-2 text-xs"
      :class="[!(disabled || option.disabled) ? 'cursor-pointer' : '', fluid ? 'flex-1' : '']"
      @click="select(option)"
    >
      <slot name="option" :option="option" :selected="isSelected(option.value)" />
    </UButton>
  </UFieldGroup>
</template>
