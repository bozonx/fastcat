export const VARDATA_DIR_NAME = 'vardata' as const;

export const VARDATA_PROJECTS_DIR_NAME = 'projects' as const;

export const VARDATA_PROJECT_PROXIES_DIR_NAME = 'proxies' as const;

export const VARDATA_PROJECT_THUMBNAILS_DIR_NAME = 'thumbnails' as const;

export const VARDATA_PROJECT_WAVEFORMS_DIR_NAME = 'waveforms' as const;

export const VARDATA_PROJECT_CACHE_DIR_NAME = 'cache' as const;

export const VARDATA_PROJECT_TRANSCRIPTIONS_DIR_NAME = 'transcriptions' as const;

export function getProjectVardataSegments(projectId: string): string[] {
  return [VARDATA_DIR_NAME, VARDATA_PROJECTS_DIR_NAME, projectId];
}

export function getProjectProxiesSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_PROXIES_DIR_NAME];
}

export function getProjectThumbnailsSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_THUMBNAILS_DIR_NAME];
}

export function getProjectWaveformsSegments(projectId: string): string[] {
  return [...getProjectThumbnailsSegments(projectId), VARDATA_PROJECT_WAVEFORMS_DIR_NAME];
}

export function getProjectCacheSegments(projectId: string): string[] {
  return [...getProjectVardataSegments(projectId), VARDATA_PROJECT_CACHE_DIR_NAME];
}

export function getProjectTranscriptionsSegments(projectId: string): string[] {
  return [...getProjectCacheSegments(projectId), VARDATA_PROJECT_TRANSCRIPTIONS_DIR_NAME];
}
