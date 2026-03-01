import {
  createDefaultUserSettings,
  type GranVideoEditorUserSettings,
} from '../../src/utils/settings';

import { deepMerge } from './merge';

export function buildUserSettings(overrides?: Partial<GranVideoEditorUserSettings>) {
  const base = createDefaultUserSettings();
  return deepMerge(base, overrides);
}
