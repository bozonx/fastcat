export function getExt(fmt: 'mp4' | 'webm' | 'mkv'): 'mp4' | 'webm' | 'mkv' {
  if (fmt === 'webm') return 'webm';
  if (fmt === 'mkv') return 'mkv';
  return 'mp4';
}

export function sanitizeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveNextAvailableFilename(
  existingNames: ReadonlySet<string>,
  base: string,
  ext: string,
): string {
  const normalizedBase = sanitizeBaseName(base);
  const normalizedExt = String(ext).replace(/^\.+/, '').toLowerCase();

  const direct = `${normalizedBase}.${normalizedExt}`;
  if (normalizedBase && normalizedExt && !existingNames.has(direct)) return direct;

  let index = 1;
  while (index < 1000) {
    const candidate = `${normalizedBase}_${String(index).padStart(3, '0')}.${normalizedExt}`;
    if (!existingNames.has(candidate)) return candidate;
    index++;
  }

  throw new Error('Failed to generate a unique filename');
}
