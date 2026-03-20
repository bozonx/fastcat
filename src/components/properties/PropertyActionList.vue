<script setup lang="ts">
/**
 * PropertyActionList.vue
 *
 * A unified component for rendering lists of action buttons in property panels.
 * Supports primary/secondary grouping and consistent styling with Nuxt UI.
 */

interface PropertyAction {
  id: string;
  label?: string;
  /** Accessibility title or tooltip */
  title?: string;
  icon?: string;
  color?: 'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'danger';
  variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';
  disabled?: boolean;
  loading?: boolean;
  hidden?: boolean;
  onClick: () => void;
}

const props = withDefaults(
  defineProps<{
    actions: PropertyAction[];
    /** Whether to render actions as a vertical list of full-width buttons */
    vertical?: boolean;
    /** Size of the buttons */
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** Justify content of the buttons */
    justify?: 'start' | 'center' | 'end';
    /** Default variant for buttons */
    variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';
    /** Default color for buttons */
    color?:
      | 'neutral'
      | 'primary'
      | 'secondary'
      | 'success'
      | 'warning'
      | 'error'
      | 'info'
      | 'danger';
    /** Additional class for the container */
    class?: any;
  }>(),
  {
    vertical: true,
    size: 'sm',
    justify: 'start',
    variant: undefined,
    color: undefined,
    class: undefined,
  },
);

const visibleActions = computed(() => props.actions.filter((action) => !action.hidden));

const justifyClass = computed(() => {
  switch (props.justify) {
    case 'center':
      return 'justify-center';
    case 'end':
      return 'justify-end';
    default:
      return 'justify-start';
  }
});
</script>

<template>
  <div
    class="w-full flex"
    :class="[vertical ? 'flex-col gap-2' : 'flex-wrap items-center gap-1', props.class]"
  >
    <UButton
      v-for="action in visibleActions"
      :key="action.id"
      :label="action.label"
      :icon="action.icon"
      :color="
        (action.color === 'danger' ? 'error' : action.color) ||
        (props.color === 'danger' ? 'error' : props.color) ||
        'neutral'
      "
      :variant="action.variant || props.variant || 'soft'"
      :disabled="action.disabled"
      :loading="action.loading"
      :title="action.title || action.label"
      :size="size"
      class="transition-all duration-200"
      :class="[vertical ? 'w-full' : '', !action.label && !vertical ? 'px-2' : '', justifyClass]"
      @click="action.onClick"
    >
      <template v-if="$slots[`action-${action.id}`]" #default>
        <slot :name="`action-${action.id}`" :action="action" />
      </template>
    </UButton>
  </div>
</template>
