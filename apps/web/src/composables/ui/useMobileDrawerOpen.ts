import { useCloseModel } from './useCloseModel';
import type { WritableComputedRef } from 'vue';

export interface MobileDrawerOpenProps {
  isOpen: boolean;
}

/**
 * Bridge a parent-driven `isOpen` prop + `close` emit onto a drawer
 * component's local `v-model:open` (e.g. `UiMobileDrawer` / `MobileTimelineDrawer`).
 */
export function useMobileDrawerOpen<E extends (e: 'close') => void>(
  props: MobileDrawerOpenProps,
  emit: E,
): WritableComputedRef<boolean> {
  return useCloseModel(
    () => props.isOpen,
    () => emit('close'),
  );
}
