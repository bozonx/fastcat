import type { CustomPreset } from './settings/presets';

export interface WorkspaceState {
  presets: {
    custom: CustomPreset[];
    defaultTextPresetId: string;
    collapsed: Record<string, boolean>;
  };
  ui: {
    recentSearchQueries: string[];
    pinnedItems: string[];
  };
}

export function createDefaultWorkspaceState(): WorkspaceState {
  return {
    presets: {
      custom: [],
      defaultTextPresetId: '',
      collapsed: {},
    },
    ui: {
      recentSearchQueries: [],
      pinnedItems: [],
    },
  };
}

/**
 * Merges partial state with default state to ensure all fields are present.
 */
export function normalizeWorkspaceState(data: any): WorkspaceState {
  const defaults = createDefaultWorkspaceState();
  if (!data || typeof data !== 'object') return defaults;

  return {
    presets: {
      custom: Array.isArray(data.presets?.custom) ? data.presets.custom : defaults.presets.custom,
      defaultTextPresetId: typeof data.presets?.defaultTextPresetId === 'string'
        ? data.presets.defaultTextPresetId
        : defaults.presets.defaultTextPresetId,
      collapsed: (data.presets?.collapsed && typeof data.presets.collapsed === 'object')
        ? data.presets.collapsed
        : defaults.presets.collapsed,
    },
    ui: {
      recentSearchQueries: Array.isArray(data.ui?.recentSearchQueries)
        ? data.ui.recentSearchQueries
        : defaults.ui.recentSearchQueries,
      pinnedItems: Array.isArray(data.ui?.pinnedItems)
        ? data.ui.pinnedItems
        : defaults.ui.pinnedItems,
    },
  };
}
