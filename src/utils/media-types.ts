export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'm4a'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'];
export const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'yaml', 'yml'];
export const TIMELINE_EXTENSIONS = ['otio'];

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
