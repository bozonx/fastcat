import {
  createDefaultProjectSettings,
  type FastCatProjectSettings,
} from '../../src/utils/project-settings';

import type { FastCatUserSettings } from '../../src/utils/settings';

import { deepMerge } from './merge';
import { buildUserSettings } from './settings';

export interface BuildProjectSettingsOptions {
  userSettings?: Partial<FastCatUserSettings>;
  projectSettings?: Partial<FastCatProjectSettings>;
}

export function buildProjectSettings(options?: BuildProjectSettingsOptions) {
  const userSettings = buildUserSettings(options?.userSettings);
  const base = createDefaultProjectSettings(userSettings);
  return deepMerge(base, options?.projectSettings);
}
