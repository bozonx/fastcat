import {
  COMMON_ROOT_DIR_NAME,
  DATA_ROOT_DIR_NAME,
  EXPORTS_TMP_ROOT_DIR_NAME,
  CACHE_ROOT_DIR_NAME,
  FILES_META_ROOT_DIR_NAME,
  IMPORTS_ROOT_DIR_NAME,
  JOBS_ROOT_DIR_NAME,
  PROJECTS_ROOT_DIR_NAME,
  PROXIES_ROOT_DIR_NAME,
  THUMBNAILS_ROOT_DIR_NAME,
  WAVEFORMS_ROOT_DIR_NAME,
  WORKSPACE_TEMP_ROOT_DIR_NAME,
  WORKSPACE_TEMP_PROJECTS_DIR_NAME,
  type StoragePathRegistry,
} from './storage-roots';
import type { TauriAppPaths } from './tauri-paths';

export interface ResolvedStorageTopology {
  projectsRoot: string;
  commonRoot: string;
  dataRoot: string;
  tempRoot: string;
  proxiesRoot: string;
  ephemeralTmpRoot: string;
}

function trimPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

function trimRootPath(path: string): string {
  return path.trim().replace(/[\\/]+$/g, '');
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
  return [...toStoragePathSegments(topology.tempRoot), WORKSPACE_TEMP_PROJECTS_DIR_NAME, projectId];
}

export function getResolvedProjectProxiesSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  const proxiesSegments = toStoragePathSegments(topology.proxiesRoot);
  return proxiesSegments.length > 0
    ? [...proxiesSegments, projectId]
    : [...getResolvedProjectTempSegments(topology, projectId), PROXIES_ROOT_DIR_NAME];
}

export function getResolvedProjectCacheSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), CACHE_ROOT_DIR_NAME];
}

export function getResolvedProjectFilesMetaSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), FILES_META_ROOT_DIR_NAME];
}

export function getResolvedProjectThumbnailsSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), THUMBNAILS_ROOT_DIR_NAME];
}

export function getResolvedProjectWaveformsSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), WAVEFORMS_ROOT_DIR_NAME];
}

export function getResolvedProjectJobsSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), JOBS_ROOT_DIR_NAME];
}

export function getResolvedProjectImportsSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), IMPORTS_ROOT_DIR_NAME];
}

export function getResolvedProjectExportsTmpSegments(
  topology: ResolvedStorageTopology,
  projectId: string,
): string[] {
  return [...getResolvedProjectTempSegments(topology, projectId), EXPORTS_TMP_ROOT_DIR_NAME];
}

export function resolveWorkspaceLocalStorageTopology(
  paths: StoragePathRegistry,
): ResolvedStorageTopology {
  const contentRootBase = trimPath(paths.contentRootPath);
  const dataRootBase = trimPath(paths.dataRootPath);
  const tempRootBase = trimPath(paths.tempRootPath);
  const proxiesRootBase = trimPath(paths.proxiesRootPath);
  const ephemeralTmpRootBase = trimPath(paths.ephemeralTmpRootPath);

  const contentBase = contentRootBase;
  const dataBase = dataRootBase || contentBase;
  const tempBase = tempRootBase || WORKSPACE_TEMP_ROOT_DIR_NAME;

  return {
    projectsRoot: joinSegments(contentBase, PROJECTS_ROOT_DIR_NAME),
    commonRoot: joinSegments(contentBase, COMMON_ROOT_DIR_NAME),
    dataRoot: joinSegments(dataBase, DATA_ROOT_DIR_NAME),
    tempRoot: tempBase,
    proxiesRoot: proxiesRootBase,
    ephemeralTmpRoot: ephemeralTmpRootBase,
  };
}

export async function resolveTauriSystemStorageTopology(input: {
  paths: StoragePathRegistry;
  appPaths: TauriAppPaths;
}): Promise<ResolvedStorageTopology> {
  const { join } = await import('@tauri-apps/api/path');
  const contentRootBase = trimRootPath(input.paths.contentRootPath);
  const dataRootBase = trimRootPath(input.paths.dataRootPath);
  const tempRootBase = trimRootPath(input.paths.tempRootPath);
  const proxiesRootBase = trimRootPath(input.paths.proxiesRootPath);
  const ephemeralTmpRootBase = trimRootPath(input.paths.ephemeralTmpRootPath);

  const contentBase = contentRootBase;
  const dataRoot = dataRootBase || (await join(input.appPaths.dataDir, DATA_ROOT_DIR_NAME));
  const tempRoot = tempRootBase || (await join(input.appPaths.cacheDir, TEMP_ROOT_DIR_NAME));
  const proxiesRoot =
    proxiesRootBase || (await join(input.appPaths.cacheDir, PROXIES_ROOT_DIR_NAME));
  const ephemeralTmpRoot =
    ephemeralTmpRootBase || (await join(input.appPaths.tempDir, 'fastcat-jobs'));

  return {
    projectsRoot: joinSegments(contentBase, PROJECTS_ROOT_DIR_NAME),
    commonRoot: joinSegments(contentBase, COMMON_ROOT_DIR_NAME),
    dataRoot,
    tempRoot,
    proxiesRoot,
    ephemeralTmpRoot,
  };
}
