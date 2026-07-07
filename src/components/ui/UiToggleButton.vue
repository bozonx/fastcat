<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
});

const attrs = useAttrs();

type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'success' | 'info';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type ButtonVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    size?: ButtonSize;
    activeColor?: ButtonColor;
    inactiveColor?: ButtonColor;
    activeVariant?: ButtonVariant;
    inactiveVariant?: ButtonVariant;
    icon?: string;
    activeIcon?: string;
    label?: string;
    disabled?: boolean;
    activeBg?: string;
    inactiveBg?: string;
    activeText?: string;
    inactiveText?: string;
    title?: string;
    square?: boolean;
    noToggle?: boolean;
    iconClass?: string;
    activeIconClass?: string;
    class?: string;
  }>(),
  {
    size: 'xs',
    activeColor: 'primary',
    inactiveColor: 'neutral',
    activeVariant: 'solid',
    inactiveVariant: 'ghost',
    icon: undefined,
    activeIcon: undefined,
    label: undefined,
    disabled: false,
    activeBg: undefined,
    inactiveBg: undefined,
    activeText: undefined,
    inactiveText: undefined,
    title: undefined,
    square: false,
    noToggle: false,
    iconClass: undefined,
    activeIconClass: undefined,
    class: undefined,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  click: [event: MouseEvent];
}>();

function onClick(event: MouseEvent) {
  (event.currentTarget as HTMLElement).blur();
  emit('click', event);
  if (props.noToggle || props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}

const computedIcon = computed(() => {
  if (props.modelValue && props.activeIcon) return props.activeIcon;
  return props.icon;
});

const computedColor = computed(() => {
  return props.modelValue ? props.activeColor : props.inactiveColor;
});

const computedVariant = computed(() => {
  return props.modelValue ? props.activeVariant : props.inactiveVariant;
});

const computedStyle = computed(() => {
  const style: Record<string, string> = {};

  if (props.modelValue) {
    if (props.activeBg) style.backgroundColor = props.activeBg;
    if (props.activeText) style.color = props.activeText;
  } else {
    if (props.inactiveBg) style.backgroundColor = props.inactiveBg;
    if (props.inactiveText) style.color = props.inactiveText;
  }

  return Object.keys(style).length ? style : undefined;
});

const computedUi = computed(() => {
  const resolved =
    props.modelValue && props.activeIconClass ? props.activeIconClass : props.iconClass;
  if (!resolved) return undefined;
  return { leadingIcon: resolved, trailingIcon: resolved };
});

const isIconOnly = computed(() => !!computedIcon.value && !props.label);

const iconOnlySizeClasses = computed(() => {
  if (!isIconOnly.value && !props.square) return '';
  switch (props.size) {
    case 'xs':
      return 'w-6 h-6';
    case 'sm':
      return 'w-7 h-7';
    case 'md':
      return 'w-8 h-8';
    case 'lg':
      return 'w-9 h-9';
    case 'xl':
      return 'w-10 h-10';
    default:
      return 'w-6 h-6';
  }
});

const iconButtonToneClass = computed(() => {
  if (
    !isIconOnly.value ||
    props.modelValue ||
    props.inactiveColor !== 'neutral' ||
    props.inactiveVariant !== 'ghost'
  ) {
    return '';
  }

  return 'text-ui-text-muted hover:text-ui-text disabled:text-ui-text-dimmed';
});
</script>

<template>
  <UButton
    v-bind="attrs"
    :size="size"
    :variant="computedVariant"
    :color="computedColor"
    :icon="computedIcon"
    :label="label"
    :disabled="disabled"
    :title="title"
    :style="computedStyle"
    :ui="computedUi"
    :aria-pressed="modelValue"
    :data-state="modelValue ? 'on' : 'off'"
    class="transition-all duration-200"
    :class="[
      square || isIconOnly
        ? ['aspect-square p-0 flex items-center justify-center shrink-0', iconOnlySizeClasses]
        : label
          ? 'w-full h-8 px-2'
          : 'w-6 h-6 p-0 flex items-center justify-center',
      modelValue ? 'opacity-100' : 'opacity-60 hover:opacity-100',
      iconButtonToneClass,
      $props.class,
    ]"
    @click="onClick"
  >
    <slot />
  </UButton>
</template>
