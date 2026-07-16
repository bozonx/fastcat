import { TICKS_PER_SECOND } from '~/utils/time';

/** Convert legacy microsecond fixture values to canonical timeline ticks. */
export function timelineTicks(value: number): number {
  return value * (TICKS_PER_SECOND / 1_000_000);
}
