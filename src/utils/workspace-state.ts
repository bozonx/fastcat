import type { CustomPreset } from './settings/presets';

export interface WorkspaceState {
  presets: {
    custom: CustomPreset[];
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
