import { nextTick } from 'vue';

/**
 * Shared `update:modelValue` handler used by select-like components. It emits the
 * new value and then blurs the active element so the menu closes immediately.
 */
export function useSelectBlurUpdate<E extends (e: 'update:modelValue', value: unknown) => void>(
  emit: E,
): (val: unknown) => void {
  return function onUpdate(val: unknown) {
    emit('update:modelValue', val);
    nextTick(() => {
      (document.activeElement as HTMLElement)?.blur();
    });
  };
}
