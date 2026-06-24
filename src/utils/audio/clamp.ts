import { clampNumber } from '~/utils/math';

export function clampAudioParam(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
): number {
  return clampNumber(value, min, max) ?? defaultValue;
}

/** Lowest/highest output-gain multiplier accepted by both audio engines. */
export const GAIN_MIN = 0;
export const GAIN_MAX = 10;

/**
 * Clamp a master/monitor volume multiplier to the shared `[0, 10]` range used by
 * both the Web Audio and Tauri native engines. Non-finite input falls back to
 * unity gain so a bad value can never silence or blow up the output.
 */
export function clampGain(volume: unknown): number {
  return clampAudioParam(volume, GAIN_MIN, GAIN_MAX, 1);
}
