export function createTimelineDocId(projectName: string): string {
  const base = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `timeline_${base || 'project'}_${crypto.randomUUID().split('-')[0]}`;
}
