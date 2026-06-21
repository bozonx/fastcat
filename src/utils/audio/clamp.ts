import { clampNumber } from '~/utils/math';

export function clampAudioParam(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
): number {
  return clampNumber(value, min, max) ?? defaultValue;
}
