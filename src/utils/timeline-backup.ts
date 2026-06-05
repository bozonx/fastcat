export function getBackupNumber(fileName: string): number | null {
  const match = fileName.match(/__bak(\d{3,})\.otio$/);
  if (!match) return null;
  return parseInt(match[1]!, 10);
}

export function getNextBackupName(baseName: string, existingNames: string[]): string {
  let maxNum = 0;
  for (const name of existingNames) {
    const num = getBackupNumber(name);
    if (num !== null && num > maxNum) {
      maxNum = num;
    }
  }
  const nextNum = maxNum + 1;
  const digits = Math.max(3, String(nextNum).length);
  return `${baseName}__bak${nextNum.toString().padStart(digits, '0')}.otio`;
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
