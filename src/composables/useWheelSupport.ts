import { onMounted, onBeforeUnmount, type Ref } from 'vue';

export interface UseWheelSupportOptions {
  wrapperRef: Ref<HTMLElement | null>;
  disabled?: () => boolean;
  step?: () => number;
  wheelStepMultiplier?: () => number;
  /** When true, applies wheelStepMultiplier (defaults to physical Shift if omitted). */
  useWheelStepMultiplier?: (e: WheelEvent) => boolean;
  onWheelStep: (direction: 1 | -1, wheelStep: number, precision: number) => void;
}

export function getStepPrecision(step: number): number {
  const stepAsString = String(step);
  const dotIndex = stepAsString.indexOf('.');
  if (dotIndex === -1) return 0;
  return stepAsString.length - dotIndex - 1;
}

export function useWheelSupport(options: UseWheelSupportOptions) {
  function onWheel(e: WheelEvent) {
    if (options.disabled?.()) return;
    e.preventDefault();

    const deltaY = Number(e.deltaY ?? 0);
    const deltaX = Number(e.deltaX ?? 0);
    const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
    if (!Number.isFinite(delta) || delta === 0) return;

    const direction = delta < 0 ? 1 : -1;
    const baseStep = (options.step?.() ?? 1) > 0 ? (options.step?.() ?? 1) : 1;
    const accelerated = options.useWheelStepMultiplier
      ? options.useWheelStepMultiplier(e)
      : e.shiftKey;
    const multiplier = accelerated ? Math.max(1, options.wheelStepMultiplier?.() ?? 1) : 1;
    const wheelStep = baseStep * multiplier;
    const precision = getStepPrecision(baseStep);

    options.onWheelStep(direction, wheelStep, precision);
  }

  onMounted(() => {
    options.wrapperRef.value?.addEventListener('wheel', onWheel, { passive: false });
  });

  onBeforeUnmount(() => {
    options.wrapperRef.value?.removeEventListener('wheel', onWheel);
  });
}
