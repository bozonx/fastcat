<script setup lang="ts" generic="T extends string | number">
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';

type ButtonColor = 'primary' | 'secondary' | 'neutral' | 'error' | 'warning' | 'success' | 'info';
type ButtonVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle';
type ButtonSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface ToggleOption<V> {
  value: V;
  icon: string;
  tooltip?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

withDefaults(
  defineProps<{
    options: ToggleOption<T>[];
    size?: ButtonSize;
    activeColor?: ButtonColor;
    activeVariant?: ButtonVariant;
    inactiveColor?: ButtonColor;
    inactiveVariant?: ButtonVariant;
  }>(),
  {
    size: 'xs',
    activeColor: 'primary',
    activeVariant: 'solid',
    inactiveColor: 'neutral',
    inactiveVariant: 'ghost',
  },
);

const modelValue = defineModel<T>({ required: true });

const emit = defineEmits<{
  change: [value: T];
}>();

function select(option: ToggleOption<T>) {
  if (option.disabled) return;
  modelValue.value = option.value;
  emit('change', option.value);
}
</script>

<template>
  <!--
    Each item is wrapped in UiTooltip, so the group's direct child is the tooltip
    trigger <span>, not the <button>. UFieldGroup's own rounding (which targets
    direct-child buttons via `first:`/`last:`) can't reach a nested button, so we
    round the nested buttons explicitly here: square inner corners, rounded ends.
  -->
  <UFieldGroup
    class="inline-flex [&>*>button]:rounded-none [&>*:first-child>button]:rounded-s-md [&>*:last-child>button]:rounded-e-md"
  >
    <UiTooltip v-for="option in options" :key="String(option.value)" :text="option.tooltip">
      <UiActionButton
        :size="size"
        :variant="modelValue === option.value ? activeVariant : inactiveVariant"
        :color="modelValue === option.value ? activeColor : inactiveColor"
        :icon="option.icon"
        :disabled="option.disabled"
        :aria-label="option.ariaLabel ?? option.tooltip"
        @click="select(option)"
      />
    </UiTooltip>
  </UFieldGroup>
</template>
