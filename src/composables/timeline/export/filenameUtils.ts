import { getNextIncrementName, parseFilename } from '~/utils/filename-increment';

export function getExt(
  fmt: 'mp4' | 'webm' | 'mkv' | 'aac' | 'opus' | 'ogg' | 'flac' | 'wav' | 'pcm' | 'mp3',
): 'mp4' | 'webm' | 'mkv' | 'aac' | 'opus' | 'ogg' | 'flac' | 'wav' | 'pcm' | 'mp3' {
  if (fmt === 'webm') return 'webm';
  if (fmt === 'mkv') return 'mkv';
  if (fmt === 'aac') return 'aac';
  if (fmt === 'opus') return 'opus';
  if (fmt === 'ogg') return 'ogg';
  if (fmt === 'flac') return 'flac';
  if (fmt === 'wav') return 'wav';
  if (fmt === 'pcm') return 'pcm';
  if (fmt === 'mp3') return 'mp3';
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
  const sanitized = sanitizeBaseName(base);
  const normalizedExt = ext ? String(ext).replace(/^\.+/, '').toLowerCase() : '';
  const dotExt = normalizedExt ? `.${normalizedExt}` : '';

  const fullFileName = `${sanitized}${dotExt}`;

  const proposed = getNextIncrementName({
    fileName: fullFileName,
    existingNames,
    style: 'underscore',
    padWidth: 3,
    startIndex: 1,
    forceIndex: false,
  });

  const parsed = parseFilename(proposed);
  if (parsed.counter !== null && parsed.counter > 1000) {
    throw new Error('Failed to generate a unique filename');
  }

  return proposed;
}
