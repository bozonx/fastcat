<script setup lang="ts">
interface DropdownActionItem {
  label: string;
  icon?: string;
  disabled?: boolean;
  onSelect?: () => void | Promise<void>;
}

const props = withDefaults(
  defineProps<{
    ariaLabel: string;
    caretAriaLabel?: string;
    color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
    disabled?: boolean;
    icon?: string;
    items: DropdownActionItem[][];
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link';
  }>(),
  {
    caretAriaLabel: undefined,
    color: 'neutral',
    disabled: false,
    icon: undefined,
    size: 'sm',
    variant: 'ghost',
  },
);

const emit = defineEmits<{
  (e: 'click'): void;
}>();

function onMainClick() {
  if (props.disabled) return;
  emit('click');
}
</script>

<template>
  <UFieldGroup>
    <UButton
      :size="size"
      :variant="variant"
      :color="color"
      :icon="icon"
      :aria-label="ariaLabel"
      :disabled="disabled"
      class="hover:bg-ui-bg"
      @click="onMainClick"
    />

    <UDropdownMenu :items="items" :disabled="disabled" :ui="{ content: 'bottom-end' }">
      <UButton
        :size="size"
        :variant="variant"
        :color="color"
        icon="i-heroicons-chevron-down"
        :aria-label="caretAriaLabel ?? ariaLabel"
        :disabled="disabled"
        class="hover:bg-ui-bg"
      />
    </UDropdownMenu>
  </UFieldGroup>
</template>
