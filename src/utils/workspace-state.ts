import type { CustomPreset } from './settings/presets';

export interface FileBrowserInstanceState {
  viewMode: 'grid' | 'list';
  sortOption: {
    field: 'name' | 'type' | 'size' | 'modified' | 'created';
    order: 'asc' | 'desc';
  };
  gridCardSize: number;
  columnWidths: Record<string, number>;
  showHiddenFiles: boolean;
  /** Relative tree-pane size (0..100). When undefined, the component uses its default. */
  treeSize?: number;
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

export const DEFAULT_FILE_BROWSER_INSTANCE: FileBrowserInstanceState = {
  viewMode: 'grid',
  sortOption: { field: 'name', order: 'asc' },
  gridCardSize: 80,
  columnWidths: { name: 200, type: 100, size: 80, created: 140, modified: 140 },
  showHiddenFiles: false,
};

export function createDefaultFileBrowserInstance(): FileBrowserInstanceState {
  return {
    ...DEFAULT_FILE_BROWSER_INSTANCE,
    sortOption: { ...DEFAULT_FILE_BROWSER_INSTANCE.sortOption },
    columnWidths: { ...DEFAULT_FILE_BROWSER_INSTANCE.columnWidths },
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
      lastProjectName: null,
      recentProjects: [],
    },
    fileBrowser: {
      instances: {},
      activeTab: 'computer',
    },
  };
}

function normalizeInstance(raw: unknown, legacyShowHidden: boolean): FileBrowserInstanceState {
  const val = (raw ?? {}) as Record<string, unknown>;
  const sortRaw = val.sortOption as Record<string, unknown> | undefined;
  const field =
    sortRaw && ['name', 'type', 'size', 'modified', 'created'].includes(sortRaw.field as string)
      ? (sortRaw.field as FileBrowserInstanceState['sortOption']['field'])
      : 'name';
  const order = sortRaw && ['asc', 'desc'].includes(sortRaw.order as string)
    ? (sortRaw.order as 'asc' | 'desc')
    : 'asc';

  return {
    viewMode: ['grid', 'list'].includes(val.viewMode as string)
      ? (val.viewMode as 'grid' | 'list')
      : 'grid',
    sortOption: { field, order },
    gridCardSize: typeof val.gridCardSize === 'number' ? val.gridCardSize : 80,
    columnWidths:
      val.columnWidths && typeof val.columnWidths === 'object'
        ? (val.columnWidths as Record<string, number>)
        : { ...DEFAULT_FILE_BROWSER_INSTANCE.columnWidths },
    showHiddenFiles:
      typeof val.showHiddenFiles === 'boolean' ? val.showHiddenFiles : legacyShowHidden,
    treeSize:
      typeof val.treeSize === 'number' && val.treeSize > 0 && val.treeSize < 100
        ? val.treeSize
        : undefined,
    lastPath: typeof val.lastPath === 'string' ? val.lastPath : undefined,
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

  // Legacy global flag — propagate to per-instance entries that lack their own value.
  const legacyShowHidden = typeof ui.showHiddenFiles === 'boolean' ? ui.showHiddenFiles : false;

  return {
    presets: {
      custom: Array.isArray(presets.custom) ? presets.custom : defaults.presets.custom,
      defaultTextPresetId:
        typeof presets.defaultTextPresetId === 'string'
          ? presets.defaultTextPresetId
          : defaults.presets.defaultTextPresetId,
      collapsed:
        presets.collapsed && typeof presets.collapsed === 'object'
          ? (presets.collapsed as Record<string, boolean>)
          : defaults.presets.collapsed,
    },
    ui: {
      recentSearchQueries: Array.isArray(ui.recentSearchQueries)
        ? (ui.recentSearchQueries as string[])
        : defaults.ui.recentSearchQueries,
      pinnedItems: Array.isArray(ui.pinnedItems)
        ? (ui.pinnedItems as string[])
        : defaults.ui.pinnedItems,
      lastProjectName:
        typeof ui.lastProjectName === 'string' || ui.lastProjectName === null
          ? (ui.lastProjectName as string | null)
          : defaults.ui.lastProjectName,
      recentProjects: Array.isArray(ui.recentProjects)
        ? (ui.recentProjects as WorkspaceState['ui']['recentProjects'])
        : defaults.ui.recentProjects,
    },
    fileBrowser: {
      instances:
        fbInstances && typeof fbInstances === 'object'
          ? Object.fromEntries(
              Object.entries(fbInstances).map(([key, val]) => [
                key,
                normalizeInstance(val, legacyShowHidden),
              ]),
            )
          : defaults.fileBrowser.instances,
      activeTab: ['computer', 'bloggerdog', 'fastcat'].includes(fileBrowser.activeTab as string)
        ? (fileBrowser.activeTab as 'computer' | 'bloggerdog' | 'fastcat')
        : defaults.fileBrowser.activeTab,
    },
  };
}
