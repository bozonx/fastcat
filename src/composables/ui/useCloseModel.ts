import { computed, type WritableComputedRef } from 'vue';

/**
 * Bridge a parent-driven `isOpen` prop + `close` emit onto a child component's
 * `v-model:open` (e.g. `UiModal` / `UiMobileDrawer`).
 *
 * Replaces the repeated boilerplate:
 * ```ts
 * const isOpenLocal = computed({
 *   get: () => props.isOpen,
 *   set: (val) => { if (!val) emit('close'); },
 * });
 * ```
 */
export function useCloseModel(
  getIsOpen: () => boolean,
  onClose: () => void,
): WritableComputedRef<boolean> {
  return computed({
    get: getIsOpen,
    set: (val) => {
      if (!val) onClose();
    },
  });
}
