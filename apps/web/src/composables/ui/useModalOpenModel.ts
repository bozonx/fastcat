import { computed, type WritableComputedRef } from 'vue';

export interface ModalOpenModelProps {
  open: boolean;
}

/**
 * Bridge a parent-driven `open` prop to a local `isOpen` v-model for modals.
 * Replaces the repeated boilerplate:
 * ```ts
 * const isOpen = computed({
 *   get: () => props.open,
 *   set: (value) => emit('update:open', value),
 * });
 * ```
 */
export function useModalOpenModel<E extends (e: 'update:open', value: boolean) => void>(
  props: ModalOpenModelProps,
  emit: E,
): WritableComputedRef<boolean> {
  return computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });
}
