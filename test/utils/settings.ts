import {
  createDefaultUserSettings,
  type FastCatUserSettings,
} from '../../src/utils/settings';

import { deepMerge } from './merge';

export function buildUserSettings(overrides?: Partial<FastCatUserSettings>) {
  const base = createDefaultUserSettings();
  return deepMerge(base, overrides);
}
