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
    buttonClass?: string;
    color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
    caretButtonClass?: string;
    disabled?: boolean;
    icon?: string;
    caretIconClass?: string;
    items: DropdownActionItem[][];
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link';
  }>(),
  {
    caretAriaLabel: undefined,
    buttonClass: '',
    color: 'neutral',
    caretButtonClass: '',
    caretIconClass: 'size-3',
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

function onMainButtonClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).blur();
  onMainClick();
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
      :class="buttonClass"
      @click="onMainButtonClick"
    />

    <UDropdownMenu :items="items" :disabled="disabled" :ui="{ content: 'bottom-end' }">
      <UButton
        :size="size"
        :variant="variant"
        :color="color"
        icon="i-heroicons-chevron-down"
        :aria-label="caretAriaLabel ?? ariaLabel"
        :disabled="disabled"
        :class="caretButtonClass"
        :ui="{ leadingIcon: caretIconClass }"
      />
    </UDropdownMenu>
  </UFieldGroup>
</template>
