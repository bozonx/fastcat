export function getExt(
  fmt: 'mp4' | 'webm' | 'mkv' | 'aac' | 'opus' | 'ogg' | 'flac' | 'wav' | 'pcm',
): 'mp4' | 'webm' | 'mkv' | 'aac' | 'opus' | 'ogg' | 'flac' | 'wav' | 'pcm' {
  if (fmt === 'webm') return 'webm';
  if (fmt === 'mkv') return 'mkv';
  if (fmt === 'aac') return 'aac';
  if (fmt === 'opus') return 'opus';
  if (fmt === 'ogg') return 'ogg';
  if (fmt === 'flac') return 'flac';
  if (fmt === 'wav') return 'wav';
  if (fmt === 'pcm') return 'pcm';
  return 'mp4';
}

export function sanitizeBaseName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const sanitized = base
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!sanitized) {
    return 'untitled';
  }

  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  if (reservedNames.test(sanitized)) {
    return `${sanitized}_`;
  }

  return sanitized;
}

export function normalizeExportFilename(name: string): string {
  return name.trim();
}

export function hasInvalidExportFilenameChars(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- intentional check for control characters in filenames
  return /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name);
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
