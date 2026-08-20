import { genUuid, randomToken } from '~/utils/ids';

export function createTimelineDocId(projectName: string): string {
  const base = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `timeline_${base || 'project'}_${genUuid().split('-')[0]}`;
}

/** Identifier for a timeline marker / zone marker (`marker_<ts>_<rand>`). */
export function createMarkerId(): string {
  return `marker_${Date.now().toString(36)}_${randomToken(8)}`;
}

/** Identifier shared by clips linked into one group (`linked-group-<ts>-<rand>`). */
export function createLinkedGroupId(): string {
  return `linked-group-${Date.now().toString(36)}-${randomToken(8)}`;
}
