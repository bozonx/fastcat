export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'm4a', 'weba'];
export const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'tiff',
  'tif',
];
export const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'yaml', 'yml'];
export const TIMELINE_EXTENSIONS = ['otio'];

export const EXTENSION_MIME_MAPPING: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  weba: 'audio/webm',
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  // Text & Project
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  otio: 'application/json',
};

export type MediaType = 'video' | 'audio' | 'image' | 'text' | 'timeline' | 'unknown';

/**
 * Returns the media type for a filename.
 */
export function getMediaTypeFromFilename(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (TIMELINE_EXTENSIONS.includes(ext)) return 'timeline';
  return 'unknown';
}

/**
 * Returns the mime type for a filename based on its extension.
 */
export function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME_MAPPING[ext] || 'application/octet-stream';
}

/**
 * Returns a Heroicon name for the media type.
 */
export function getIconForMediaType(type: MediaType): string {
  switch (type) {
    case 'video':
      return 'i-heroicons-film';
    case 'audio':
      return 'i-heroicons-musical-note';
    case 'image':
      return 'i-heroicons-photo';
    case 'text':
      return 'i-heroicons-document-text';
    case 'timeline':
      return 'i-heroicons-document-text';
    default:
      return 'i-heroicons-document';
  }
}

export function isOpenableProjectTextFilename(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ext === 'md' || ext === 'txt';
}

export function isOpenableProjectFileName(filename: string): boolean {
  const type = getMediaTypeFromFilename(filename);
  if (type === 'video' || type === 'audio' || type === 'image') return true;
  return isOpenableProjectTextFilename(filename);
}
