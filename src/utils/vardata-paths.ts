import { isWorkspaceCommonPath, stripWorkspaceCommonPathPrefix } from '~/utils/workspace-common';
import {
  COMMON_ROOT_DIR_NAME,
  PROXIES_ROOT_DIR_NAME,
  WORKSPACE_TEMP_PROJECTS_DIR_NAME,
  WORKSPACE_TEMP_ROOT_DIR_NAME,
} from '~/utils/storage-roots';

export const VARDATA_DIR_NAME = WORKSPACE_TEMP_ROOT_DIR_NAME;

export const VARDATA_COMMON_DIR_NAME = COMMON_ROOT_DIR_NAME;

export const VARDATA_PROJECTS_DIR_NAME = WORKSPACE_TEMP_PROJECTS_DIR_NAME;

export const VARDATA_PROJECT_PROXIES_DIR_NAME = PROXIES_ROOT_DIR_NAME;

export const VARDATA_PROJECT_THUMBNAILS_DIR_NAME = 'thumbnails' as const;

export const VARDATA_PROJECT_WAVEFORMS_DIR_NAME = 'waveforms' as const;

export const VARDATA_PROJECT_CACHE_DIR_NAME = 'cache' as const;

export const VARDATA_PROJECT_TMP_DIR_NAME = 'tmp' as const;

export const VARDATA_PROJECT_TRANSCRIPTIONS_DIR_NAME = 'transcriptions' as const;

export interface VardataScopeSegmentsInput {
  path: string;
  projectId: string;
}

export function getProjectVardataSegments(projectId: string): string[] {
  return [VARDATA_DIR_NAME, VARDATA_PROJECTS_DIR_NAME, projectId];
}

export function getCommonVardataSegments(): string[] {
  return [VARDATA_DIR_NAME, VARDATA_COMMON_DIR_NAME];
}

export function getScopedProjectRelativePath(path: string): string {
  return isWorkspaceCommonPath(path) ? stripWorkspaceCommonPathPrefix(path) : path;
}

export function getScopedVardataSegments(input: VardataScopeSegmentsInput): string[] {
  return isWorkspaceCommonPath(input.path)
    ? getCommonVardataSegments()
    : getProjectVardataSegments(input.projectId);
}

export function getProjectProxiesSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_PROXIES_DIR_NAME];
}

export function getScopedProxiesSegments(input: VardataScopeSegmentsInput): string[] {
  return [...getScopedVardataSegments(input), VARDATA_PROJECT_PROXIES_DIR_NAME];
}

export function getProjectThumbnailsSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_THUMBNAILS_DIR_NAME];
}

export function getScopedThumbnailsSegments(input: VardataScopeSegmentsInput): string[] {
  return [...getScopedVardataSegments(input), VARDATA_PROJECT_THUMBNAILS_DIR_NAME];
}

export function getProjectWaveformsSegments(projectId: string): string[] {
  return [...getProjectThumbnailsSegments(projectId), VARDATA_PROJECT_WAVEFORMS_DIR_NAME];
}

export function getScopedWaveformsSegments(input: VardataScopeSegmentsInput): string[] {
  return [...getScopedThumbnailsSegments(input), VARDATA_PROJECT_WAVEFORMS_DIR_NAME];
}

export function getProjectCacheSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_CACHE_DIR_NAME];
}

export function getScopedCacheSegments(input: VardataScopeSegmentsInput): string[] {
  return [...getScopedVardataSegments(input), VARDATA_PROJECT_CACHE_DIR_NAME];
}

export function getProjectTmpSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_TMP_DIR_NAME];
}

export function getProjectTranscriptionsSegments(projectId: string): string[] {
  return [...getProjectCacheSegments(projectId), VARDATA_PROJECT_TRANSCRIPTIONS_DIR_NAME];
}

export function getScopedTranscriptionsSegments(input: VardataScopeSegmentsInput): string[] {
  return [...getScopedCacheSegments(input), VARDATA_PROJECT_TRANSCRIPTIONS_DIR_NAME];
}
