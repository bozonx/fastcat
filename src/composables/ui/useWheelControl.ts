import { ref } from 'vue';
import { useWheelSupport } from '~/composables/useWheelSupport';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';

export interface UseWheelControlOptions {
  disabled?: () => boolean;
  step: () => number;
  wheelStepMultiplier?: () => number;
  focusOnly?: () => boolean;
}

/**
 * Shared wheel control setup for number/slider inputs. Takes care of the common
 * `useWheelSupport` configuration (workspace layer multiplier, focus handling,
 * etc.) so components only need to provide the per-step value update logic.
 */
export function useWheelControl(
  options: UseWheelControlOptions,
  onWheelStep: (direction: 1 | -1, wheelStep: number, precision: number) => void,
) {
  const wrapperRef = ref<HTMLElement | null>(null);
  const workspaceStore = useWorkspaceStore();

  useWheelSupport({
    wrapperRef,
    disabled: options.disabled,
    step: options.step,
    wheelStepMultiplier: options.wheelStepMultiplier,
    useWheelStepMultiplier: (e) => isLayer1Active(e, workspaceStore.userSettings),
    focusOnly: options.focusOnly?.() ?? false,
    onWheelStep,
  });

  return { wrapperRef };
}
