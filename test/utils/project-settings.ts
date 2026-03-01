import {
  createDefaultProjectSettings,
  type GranVideoEditorProjectSettings,
} from '../../src/utils/project-settings';

import type { GranVideoEditorUserSettings } from '../../src/utils/settings';

import { deepMerge } from './merge';
import { buildUserSettings } from './settings';

export interface BuildProjectSettingsOptions {
  userSettings?: Partial<GranVideoEditorUserSettings>;
  projectSettings?: Partial<GranVideoEditorProjectSettings>;
}

export function buildProjectSettings(options?: BuildProjectSettingsOptions) {
  const userSettings = buildUserSettings(options?.userSettings);
  const base = createDefaultProjectSettings(userSettings);
  return deepMerge(base, options?.projectSettings);
}
