<script setup lang="ts">
type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'success' | 'info';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type ButtonVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';

const props = withDefaults(
  defineProps<{
    size?: ButtonSize;
    variant?: ButtonVariant;
    color?: ButtonColor;
    icon?: string;
    label?: string;
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    square?: boolean;
    hoverClass?: string;
  }>(),
  {
    size: 'sm',
    variant: 'ghost',
    color: 'neutral',
    icon: undefined,
    label: undefined,
    loading: false,
    disabled: false,
    block: false,
    square: false,
    hoverClass: 'hover:bg-ui-bg-hover',
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

function onClick(event: MouseEvent) {
  if (props.disabled || props.loading) return;
  (event.currentTarget as HTMLElement).blur();
  emit('click', event);
}
</script>

<template>
  <UButton
    :size="size"
    :variant="variant"
    :color="color"
    :icon="icon"
    :label="label"
    :loading="loading"
    :disabled="disabled"
    :class="[hoverClass, block ? 'w-full' : '', square ? 'aspect-square p-0' : '']"
    @click="onClick"
  >
    <slot />
  </UButton>
</template>
