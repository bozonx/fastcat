<script setup lang="ts">
/**
 * A wrapper around UFormField that provides a consistent design system for labels.
 * Labels are always muted (text-ui-text-muted) and follow a uniform typography.
 *
 * Optional reset button: pass `resettable` to show a reset icon next to the slot
 * content. The button only renders when `resettable` is true. Use `resetTooltip`
 * for hover text and listen to the `reset` event.
 */
import UiTooltip from '~/components/ui/UiTooltip.vue';

interface Props {
  label?: string;
  description?: string;
  help?: string;
  error?: string | boolean;
  required?: boolean;
  /** Show the reset button when true */
  resettable?: boolean;
  /** Tooltip text for the reset button */
  resetTooltip?: string;
  /** Vertical alignment of the reset button row: 'center' (default) or 'start' */
  resetAlign?: 'center' | 'start';
}

const props = defineProps<Props>();

const emit = defineEmits<{
  reset: [];
}>();

const slots = useSlots();

// Props forwarded to UFormField (exclude reset-related ones)
const fieldProps = computed(() => ({
  label: props.label,
  description: props.description,
  help: props.help,
  error: props.error,
  required: props.required,
}));

// Slots other than 'default' to forward
const nonDefaultSlots = computed(() => {
  const result: Record<string, typeof slots[string]> = {};
  for (const key of Object.keys(slots)) {
    if (key !== 'default') result[key] = slots[key];
  }
  return result;
});
</script>

<template>
  <UFormField
    v-bind="fieldProps"
    class="flex flex-col gap-1 text-sm"
    :ui="{
      label: 'text-ui-text-muted font-medium mb-0',
      help: 'text-ui-text-muted/70 mt-1 text-xs',
      description: 'text-ui-text-muted/70 mb-1 text-xs',
      error: 'text-error-500 mt-1',
    }"
  >
    <template #default>
      <!-- When resettable prop is used, wrap default slot in a flex row with the reset button -->
      <div v-if="resettable !== undefined" class="flex gap-2" :class="resetAlign === 'start' ? 'items-start' : 'items-center'">
        <div class="flex-1 min-w-0">
          <slot />
        </div>
        <UiTooltip v-if="resettable" :text="resetTooltip ?? ''">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-heroicons-arrow-path"
            @click="emit('reset')"
          />
        </UiTooltip>
      </div>
      <!-- Otherwise render slot content directly -->
      <slot v-else />
    </template>

    <!-- Forward non-default slots -->
    <template v-for="(_, slot) in nonDefaultSlots" #[slot]="slotProps">
      <slot :name="slot" v-bind="slotProps" />
    </template>
  </UFormField>
</template>

