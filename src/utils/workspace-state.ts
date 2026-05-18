import type { CustomPreset } from './settings/presets';

export interface FileBrowserInstanceState {
  viewMode: 'grid' | 'list';
  sortOption: {
    field: 'name' | 'type' | 'size' | 'modified' | 'created';
    order: 'asc' | 'desc';
  };
  gridCardSize: number;
  columnWidths: Record<string, number>;
  lastPath?: string;
}

export interface WorkspaceState {
  presets: {
    custom: CustomPreset[];
    defaultTextPresetId: string;
    collapsed: Record<string, boolean>;
  };
  ui: {
    recentSearchQueries: string[];
    pinnedItems: string[];
    showHiddenFiles: boolean;
    fsSidebarWidth: number;
    lastProjectName: string | null;
    recentProjects: Array<{
      projectName: string;
      projectId: string;
      updatedAt: string;
      lastTimelinePath?: string;
    }>;
  };
  fileBrowser: {
    instances: Record<string, FileBrowserInstanceState>;
    activeTab: 'computer' | 'bloggerdog' | 'fastcat';
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
      showHiddenFiles: false,
      fsSidebarWidth: 0,
      lastProjectName: null,
      recentProjects: [],
    },
    fileBrowser: {
      instances: {},
      activeTab: 'computer',
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
      defaultTextPresetId:
        typeof data.presets?.defaultTextPresetId === 'string'
          ? data.presets.defaultTextPresetId
          : defaults.presets.defaultTextPresetId,
      collapsed:
        data.presets?.collapsed && typeof data.presets.collapsed === 'object'
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
      showHiddenFiles:
        typeof data.ui?.showHiddenFiles === 'boolean'
          ? data.ui.showHiddenFiles
          : defaults.ui.showHiddenFiles,
      fsSidebarWidth:
        typeof data.ui?.fsSidebarWidth === 'number'
          ? data.ui.fsSidebarWidth
          : defaults.ui.fsSidebarWidth,
      lastProjectName:
        typeof data.ui?.lastProjectName === 'string' || data.ui?.lastProjectName === null
          ? data.ui.lastProjectName
          : defaults.ui.lastProjectName,
      recentProjects: Array.isArray(data.ui?.recentProjects)
        ? data.ui.recentProjects
        : defaults.ui.recentProjects,
    },
    fileBrowser: {
      instances:
        data.fileBrowser?.instances && typeof data.fileBrowser.instances === 'object'
          ? Object.fromEntries(
              Object.entries(data.fileBrowser.instances).map(([key, val]) => [
                key,
                {
                  viewMode: ['grid', 'list'].includes((val as any)?.viewMode)
                    ? (val as any).viewMode
                    : 'grid',
                  sortOption:
                    (val as any)?.sortOption &&
                    ['name', 'type', 'size', 'modified', 'created'].includes(
                      (val as any).sortOption.field,
                    )
                      ? {
                          field: (val as any).sortOption.field,
                          order: ['asc', 'desc'].includes((val as any).sortOption.order)
                            ? (val as any).sortOption.order
                            : 'asc',
                        }
                      : { field: 'name', order: 'asc' },
                  gridCardSize:
                    typeof (val as any)?.gridCardSize === 'number' ? (val as any).gridCardSize : 80,
                  columnWidths:
                    (val as any)?.columnWidths && typeof (val as any).columnWidths === 'object'
                      ? (val as any).columnWidths
                      : { name: 200, type: 100, size: 80, created: 140, modified: 140 },
                  lastPath:
                    typeof (val as any)?.lastPath === 'string' ? (val as any).lastPath : undefined,
                },
              ]),
            )
          : defaults.fileBrowser.instances,
      activeTab: ['computer', 'bloggerdog', 'fastcat'].includes(data.fileBrowser?.activeTab)
        ? data.fileBrowser.activeTab
        : defaults.fileBrowser.activeTab,
    },
  };
}
