export function normalizeFsPath(path: string): string {
  const segments = path.split('/');
  const resolved: string[] = [];
  for (const raw of segments) {
    const part = raw.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      // never escape above root — silently drop
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}
