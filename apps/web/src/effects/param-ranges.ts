import type { EffectParamRange } from './core/registry';

export interface EffectNumericInputRange {
  min: number;
  max: number;
}

export function getEffectNumericInputRanges(
  paramRanges: Record<string, EffectParamRange> | undefined,
): Record<string, EffectNumericInputRange> | undefined {
  if (!paramRanges) return undefined;

  return Object.fromEntries(
    Object.entries(paramRanges).map(([key, range]) => [
      key,
      { min: range.animationMin, max: range.animationMax },
    ]),
  );
}
