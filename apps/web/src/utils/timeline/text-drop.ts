export function isTimelineTextDropFileName(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'txt' || ext === 'md';
}
