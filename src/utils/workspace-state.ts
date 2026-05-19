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
export function normalizeWorkspaceState(data: unknown): WorkspaceState {
  const defaults = createDefaultWorkspaceState();
  if (!data || typeof data !== 'object') return defaults;
  const d = data as Record<string, unknown>;

  const presets = (d.presets as Record<string, unknown> | undefined) ?? {};
  const ui = (d.ui as Record<string, unknown> | undefined) ?? {};
  const fileBrowser = (d.fileBrowser as Record<string, unknown> | undefined) ?? {};
  const fbInstances = fileBrowser.instances as Record<string, unknown> | undefined;

  return {
    presets: {
      custom: Array.isArray(presets.custom) ? presets.custom : defaults.presets.custom,
      defaultTextPresetId:
        typeof presets.defaultTextPresetId === 'string'
          ? presets.defaultTextPresetId
          : defaults.presets.defaultTextPresetId,
      collapsed:
        presets.collapsed && typeof presets.collapsed === 'object'
          ? presets.collapsed
          : defaults.presets.collapsed,
    },
    ui: {
      recentSearchQueries: Array.isArray(ui.recentSearchQueries)
        ? ui.recentSearchQueries
        : defaults.ui.recentSearchQueries,
      pinnedItems: Array.isArray(ui.pinnedItems)
        ? ui.pinnedItems
        : defaults.ui.pinnedItems,
      showHiddenFiles:
        typeof ui.showHiddenFiles === 'boolean'
          ? ui.showHiddenFiles
          : defaults.ui.showHiddenFiles,
      fsSidebarWidth:
        typeof ui.fsSidebarWidth === 'number'
          ? ui.fsSidebarWidth
          : defaults.ui.fsSidebarWidth,
      lastProjectName:
        typeof ui.lastProjectName === 'string' || ui.lastProjectName === null
          ? ui.lastProjectName
          : defaults.ui.lastProjectName,
      recentProjects: Array.isArray(ui.recentProjects)
        ? ui.recentProjects
        : defaults.ui.recentProjects,
    },
    fileBrowser: {
      instances:
        fbInstances && typeof fbInstances === 'object'
          ? Object.fromEntries(
              Object.entries(fbInstances).map(([key, val]) => [
                key,
                {
                  viewMode: ['grid', 'list'].includes((val as Record<string, unknown>)?.viewMode as string)
                    ? (val as Record<string, unknown>).viewMode as 'grid' | 'list'
                    : 'grid',
                  sortOption:
                    (val as Record<string, unknown>)?.sortOption &&
                    ['name', 'type', 'size', 'modified', 'created'].includes(
                      ((val as Record<string, unknown>).sortOption as Record<string, unknown>)?.field as string,
                    )
                      ? {
                          field: ((val as Record<string, unknown>).sortOption as Record<string, unknown>).field as 'name' | 'type' | 'size' | 'modified' | 'created',
                          order: ['asc', 'desc'].includes(
                            ((val as Record<string, unknown>).sortOption as Record<string, unknown>).order as string,
                          )
                            ? ((val as Record<string, unknown>).sortOption as Record<string, unknown>).order as 'asc' | 'desc'
                            : 'asc',
                        }
                      : { field: 'name', order: 'asc' },
                  gridCardSize:
                    typeof (val as Record<string, unknown>)?.gridCardSize === 'number' ? (val as Record<string, unknown>).gridCardSize as number : 80,
                  columnWidths:
                    (val as Record<string, unknown>)?.columnWidths && typeof (val as Record<string, unknown>).columnWidths === 'object'
                      ? (val as Record<string, unknown>).columnWidths as Record<string, number>
                      : { name: 200, type: 100, size: 80, created: 140, modified: 140 },
                  lastPath:
                    typeof (val as Record<string, unknown>)?.lastPath === 'string' ? (val as Record<string, unknown>).lastPath as string : undefined,
                },
              ]),
            )
          : defaults.fileBrowser.instances,
      activeTab: ['computer', 'bloggerdog', 'fastcat'].includes(fileBrowser.activeTab as string)
        ? fileBrowser.activeTab as 'computer' | 'bloggerdog' | 'fastcat'
        : defaults.fileBrowser.activeTab,
    },
  };
}
