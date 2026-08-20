import { cloneValue } from '~/utils/clone';

export function cloneMonitorValue<T>(value: T): T {
  return cloneValue(value);
}
