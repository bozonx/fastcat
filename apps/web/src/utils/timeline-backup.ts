import { getNextIncrementName } from '~/utils/filename-increment';

export function getBackupNumber(fileName: string): number | null {
  const match = fileName.match(/__bak(\d{3,})\.otio$/);
  if (!match) return null;
  return parseInt(match[1]!, 10);
}

export function getNextBackupName(baseName: string, existingNames: string[]): string {
  const dummyName = `${baseName}__bak001.otio`;
  return getNextIncrementName({
    fileName: dummyName,
    existingNames,
    style: 'none',
    padWidth: 3,
    startIndex: 1,
    forceIndex: true,
  });
}

export function getBackupsToDelete(existingNames: string[], maxCount: number): string[] {
  const sorted = existingNames
    .map((name) => ({ name, num: getBackupNumber(name) }))
    .filter((item): item is { name: string; num: number } => item.num !== null)
    .sort((a, b) => a.num - b.num);

  if (sorted.length < maxCount) return [];
  const toDeleteCount = sorted.length - maxCount + 1;
  return sorted.slice(0, toDeleteCount).map((item) => item.name);
}
