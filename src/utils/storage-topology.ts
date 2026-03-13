import {
  COMMON_ROOT_DIR_NAME,
  DATA_ROOT_DIR_NAME,
  PROJECTS_ROOT_DIR_NAME,
  PROXIES_ROOT_DIR_NAME,
  WORKSPACE_TEMP_ROOT_DIR_NAME,
  type StoragePathRegistry,
} from './storage-roots';

export interface ResolvedStorageTopology {
  projectsRoot: string;
  commonRoot: string;
  dataRoot: string;
  tempRoot: string;
  proxiesRoot: string;
}

export const RESOLVED_PROJECT_CACHE_DIR_NAME = 'cache';
export const RESOLVED_PROJECT_THUMBNAILS_DIR_NAME = 'thumbnails';
export const RESOLVED_PROJECT_WAVEFORMS_DIR_NAME = 'waveforms';

function trimPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

function joinSegments(...segments: Array<string | undefined>): string {
  return segments
    .map((segment) => (segment ? trimPath(segment) : ''))
    .filter((segment) => segment.length > 0)
    .join('/');
}

export function toStoragePathSegments(path: string): string[] {
  const normalized = trimPath(path);
  return normalized ? normalized.split('/').filter(Boolean) : [];
}

export function getResolvedProjectTempSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...toStoragePathSegments(topology.tempRoot), projectId];
}

export function getResolvedProjectProxiesSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  const proxiesSegments = toStoragePathSegments(topology.proxiesRoot);
  return proxiesSegments.length > 0 ? [...proxiesSegments, projectId] : [projectId, 'proxies'];
}

export function getResolvedProjectCacheSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), RESOLVED_PROJECT_CACHE_DIR_NAME];
}

export function getResolvedProjectThumbnailsSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [
    ...getResolvedProjectTempSegments(topology, projectId),
    RESOLVED_PROJECT_THUMBNAILS_DIR_NAME,
  ];
}

export function getResolvedProjectWaveformsSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [
    ...getResolvedProjectCacheSegments(topology, projectId),
    RESOLVED_PROJECT_WAVEFORMS_DIR_NAME,
  ];
}

export function resolveWorkspaceLocalStorageTopology(
  paths: StoragePathRegistry,
): ResolvedStorageTopology {
  const contentRootBase = trimPath(paths.contentRootPath);
  const dataRootBase = trimPath(paths.dataRootPath);
  const tempRootBase = trimPath(paths.tempRootPath);
  const proxiesRootBase = trimPath(paths.proxiesRootPath);

  const contentBase = contentRootBase;
  const dataBase = dataRootBase || contentBase;
  const tempBase = tempRootBase || WORKSPACE_TEMP_ROOT_DIR_NAME;

  return {
    projectsRoot: joinSegments(contentBase, PROJECTS_ROOT_DIR_NAME),
    commonRoot: joinSegments(contentBase, COMMON_ROOT_DIR_NAME),
    dataRoot: joinSegments(dataBase, DATA_ROOT_DIR_NAME),
    tempRoot: tempBase,
    proxiesRoot: proxiesRootBase || joinSegments(tempBase, PROXIES_ROOT_DIR_NAME),
  };
}
