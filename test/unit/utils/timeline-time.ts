import { TICKS_PER_MICROSECOND } from '~/utils/time';

/** Convert legacy microsecond fixture values to the active timeline tick base. */
export function timelineUs(value: number): number {
  return value * TICKS_PER_MICROSECOND;
}
