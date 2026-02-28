export function normalizeFsPath(path: string): string {
  return path
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');
}
