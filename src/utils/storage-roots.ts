export const FASTCAT_CONFIG_DIR_NAME = '.fastcat-config';
export const LEGACY_WORKSPACE_CONFIG_DIR_NAME = '.gran-workspace';

export const FASTCAT_CONTENT_ROOT_DIR_NAME = 'FastCat';
export const WORKSPACE_TEMP_ROOT_DIR_NAME = 'vardata';

export const PROJECTS_ROOT_DIR_NAME = 'projects';
export const COMMON_ROOT_DIR_NAME = 'common';
export const DATA_ROOT_DIR_NAME = 'data';
export const TEMP_ROOT_DIR_NAME = 'temp';
export const PROXIES_ROOT_DIR_NAME = 'proxies';
export const WORKSPACE_TEMP_PROJECTS_DIR_NAME = 'projects';

export const STORAGE_ROOT_IDS = [
  'projectsRoot',
  'commonRoot',
  'dataRoot',
  'tempRoot',
  'proxiesRoot',
] as const;

export type StorageRootId = (typeof STORAGE_ROOT_IDS)[number];

export type StoragePlacementMode = 'system-default' | 'portable';

export interface StoragePathRegistry {
  contentRootPath: string;
  dataRootPath: string;
  tempRootPath: string;
  proxiesRootPath: string;
  placementMode: StoragePlacementMode;
}

export interface WorkspaceStorageTopology {
  projectsDirName: string;
  commonDirName: string;
  tempRootDirName: string;
  tempProjectsDirName: string;
  configDirName: string;
  legacyConfigDirName: string;
}

export function getWorkspaceStorageTopology(): WorkspaceStorageTopology {
  return {
    projectsDirName: PROJECTS_ROOT_DIR_NAME,
    commonDirName: COMMON_ROOT_DIR_NAME,
    tempRootDirName: WORKSPACE_TEMP_ROOT_DIR_NAME,
    tempProjectsDirName: WORKSPACE_TEMP_PROJECTS_DIR_NAME,
    configDirName: FASTCAT_CONFIG_DIR_NAME,
    legacyConfigDirName: LEGACY_WORKSPACE_CONFIG_DIR_NAME,
  };
}
